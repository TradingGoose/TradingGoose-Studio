'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { AtSign, Loader2, Paperclip, Send, X } from 'lucide-react'
import { Button, Textarea } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useCopilotStore } from '@/stores/copilot/store'
import { ContextUsagePill } from '../context-usage-pill/context-usage-pill'
import { AccessLevelSelector } from './components/access-level-selector'
import { AttachedFilesGrid } from './components/attached-files-grid'
import { MentionMenu } from './components/mention-menu'
import { ModelSelector } from './components/model-selector'
import { MAX_MENTION_MENU_HEIGHT, MAX_TEXTAREA_HEIGHT } from './constants'
import { useUserInputAttachments } from './hooks/use-user-input-attachments'
import { useUserInputMentionSources } from './hooks/use-user-input-mention-sources'
import { useUserInputMentions } from './hooks/use-user-input-mentions'
import { buildMentionEditorSegments, getMentionTextareaCaretClientRect } from './mention-editor-dom'
import { getPreferredMentionMenuWidth } from './mention-utils'
import type {
  AttachedFile,
  MentionPortalStyle,
  MessageFileAttachment,
  UserInputProps,
  UserInputRef,
} from './types'

const logger = createLogger('CopilotUserInput')

const UserInput = forwardRef<UserInputRef, UserInputProps>(
  (
    {
      workspaceId,
      onSubmit,
      onAbort,
      disabled = false,
      isLoading = false,
      isAborting = false,
      placeholder,
      className,
      accessLevel = 'limited',
      onAccessLevelChange,
      value: controlledValue,
      onChange: onControlledChange,
      panelWidth = 308,
      hideContextUsage = false,
      clearOnSubmit = true,
    },
    ref
  ) => {
    const [internalMessage, setInternalMessage] = useState('')
    const [isNearTop, setIsNearTop] = useState(false)
    const [mentionPortalStyle, setMentionPortalStyle] = useState<MentionPortalStyle | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const overlayRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const mentionMenuRef = useRef<HTMLDivElement>(null)
    const mentionPortalRef = useRef<HTMLDivElement>(null)
    const menuListRef = useRef<HTMLDivElement>(null)
    const { data: session } = useSession()
    const { contextUsage, createNewChat } = useCopilotStore()
    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => { }) : setInternalMessage

    const {
      attachedFiles,
      clearAttachedFiles,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      isDragging,
      processFiles,
      removeFile,
    } = useUserInputAttachments({ userId: session?.user?.id })
    const { ensureSubmenuLoaded, mentionLoading, mentionSources } = useUserInputMentionSources({
      workspaceId,
    })
    const {
      aggregatedActive,
      closeMentionMenu,
      clearSelectedContexts,
      handleAggregatedItemSelect,
      handleInputChange,
      insertTextAtSelection,
      handleKeyDown: handleMentionKeyDown,
      handleMainMentionOptionSelect,
      handleOpenMentionMenuWithAt,
      handleSelectAdjust,
      handleSubmenuItemSelect,
      inAggregated,
      mentionActiveIndex,
      mentionQuery,
      mentionRanges,
      openSubmenuFor,
      selectedContexts,
      setInAggregated,
      setMentionActiveIndex,
      setSubmenuActiveIndex,
      showMentionMenu,
      submenuActiveIndex,
      submenuQuery,
    } = useUserInputMentions({
      disabled,
      isLoading,
      menuListRef,
      message,
      mentionSources,
      setMessage,
      textareaRef,
      workspaceId,
      loaders: {
        ensureSubmenuLoaded,
      },
    })
    const editorSegments = buildMentionEditorSegments(message, mentionRanges)

    const effectivePlaceholder =
      placeholder ||
      (accessLevel === 'limited'
        ? 'Ask questions or request workflow, skill, indicator, or tool changes'
        : 'Describe the workflow, skill, indicator, MCP, or custom-tool changes to run')

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const textarea = textareaRef.current
          if (!textarea) {
            return
          }

          textarea.focus()
          const length = message.length
          textarea.setSelectionRange(length, length)
        },
      }),
      [message]
    )

    useEffect(() => {
      const textarea = textareaRef.current
      const overlay = overlayRef.current
      if (!textarea) {
        return
      }

      textarea.style.height = 'auto'
      const nextHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)
      const overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'
      textarea.style.height = `${nextHeight}px`
      textarea.style.overflowY = overflowY

      if (overlay) {
        overlay.style.height = `${nextHeight}px`
        overlay.style.overflowY = overflowY
        overlay.scrollTop = textarea.scrollTop
        overlay.scrollLeft = textarea.scrollLeft
      }
    }, [message])

    useEffect(() => {
      const textarea = textareaRef.current
      const overlay = overlayRef.current
      if (!textarea || !overlay || typeof window === 'undefined') {
        return
      }

      const syncOverlayStyles = () => {
        const styles = window.getComputedStyle(textarea)
        overlay.style.font = styles.font
        overlay.style.letterSpacing = styles.letterSpacing
        overlay.style.padding = styles.padding
        overlay.style.lineHeight = styles.lineHeight
        overlay.style.whiteSpace = styles.whiteSpace
        overlay.style.wordBreak = styles.wordBreak
        overlay.style.width = `${textarea.clientWidth}px`
        overlay.style.height = `${textarea.clientHeight}px`
        overlay.style.borderRadius = styles.borderRadius
      }

      syncOverlayStyles()

      let resizeObserver: ResizeObserver | null = null
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(syncOverlayStyles)
        resizeObserver.observe(textarea)
      }

      window.addEventListener('resize', syncOverlayStyles)

      return () => {
        resizeObserver?.disconnect()
        window.removeEventListener('resize', syncOverlayStyles)
      }
    }, [panelWidth])

    useEffect(() => {
      const checkPosition = () => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          setIsNearTop(rect.top < 300)
        }
      }

      checkPosition()

      const scrollContainer = containerRef.current?.closest('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', checkPosition, { passive: true })
      }

      window.addEventListener('scroll', checkPosition, true)
      window.addEventListener('resize', checkPosition)

      return () => {
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', checkPosition)
        }
        window.removeEventListener('scroll', checkPosition, true)
        window.removeEventListener('resize', checkPosition)
      }
    }, [])

    useEffect(() => {
      if (showMentionMenu && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setIsNearTop(rect.top < 300)
      }
    }, [showMentionMenu])

    useEffect(() => {
      if (!showMentionMenu) {
        return
      }

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node | null
        if (
          mentionMenuRef.current &&
          !mentionMenuRef.current.contains(target) &&
          (!mentionPortalRef.current || !mentionPortalRef.current.contains(target)) &&
          textareaRef.current &&
          !textareaRef.current.contains(target as Node)
        ) {
          closeMentionMenu()
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [closeMentionMenu, showMentionMenu])

    useEffect(() => {
      const updatePosition = () => {
        if (!showMentionMenu || !containerRef.current || !textareaRef.current) {
          setMentionPortalStyle(null)
          return
        }

        const rect = containerRef.current.getBoundingClientRect()
        const textarea = textareaRef.current
        const margin = 8
        const spaceAbove = rect.top - margin
        const spaceBelow = window.innerHeight - rect.bottom - margin
        const showBelow = rect.top < 300 || spaceBelow > spaceAbove
        const maxHeight = Math.min(
          Math.max(showBelow ? spaceBelow : spaceAbove, 120),
          MAX_MENTION_MENU_HEIGHT
        )
        const menuWidth = getPreferredMentionMenuWidth(openSubmenuFor, aggregatedActive, rect.width)
        const caretPos = textarea.selectionStart ?? message.length
        const caretRect =
          getMentionTextareaCaretClientRect(textarea, message, caretPos) ??
          textarea.getBoundingClientRect()
        const minLeft = rect.left
        const maxLeft = Math.max(rect.left, rect.right - menuWidth)

        setMentionPortalStyle({
          top: showBelow ? rect.bottom + 4 : rect.top - 4,
          left: Math.min(Math.max(caretRect.left, minLeft), maxLeft),
          width: menuWidth,
          maxHeight,
          showBelow,
        })

        setIsNearTop(showBelow)
      }

      let rafId: number | null = null
      if (showMentionMenu) {
        updatePosition()
        window.addEventListener('resize', updatePosition)

        const scrollContainer = containerRef.current?.closest('[data-radix-scroll-area-viewport]')
        if (scrollContainer) {
          scrollContainer.addEventListener('scroll', updatePosition, { passive: true })
        }

        const loop = () => {
          updatePosition()
          rafId = requestAnimationFrame(loop)
        }

        rafId = requestAnimationFrame(loop)

        return () => {
          window.removeEventListener('resize', updatePosition)
          if (scrollContainer) {
            scrollContainer.removeEventListener('scroll', updatePosition)
          }
          if (rafId) {
            cancelAnimationFrame(rafId)
          }
        }
      }
    }, [aggregatedActive, message, openSubmenuFor, showMentionMenu])

    const handleSubmit = async () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) {
        return
      }

      const failedUploads = attachedFiles.filter((file) => !file.uploading && !file.key)
      if (failedUploads.length > 0) {
        logger.error(
          `Some files failed to upload: ${failedUploads.map((file) => file.name).join(', ')}`
        )
      }

      const fileAttachments = attachedFiles
        .filter((file) => !file.uploading && file.key)
        .map((file) => ({
          id: file.id,
          key: file.key!,
          filename: file.name,
          media_type: file.type,
          size: file.size,
        }))

      onSubmit(trimmedMessage, fileAttachments, selectedContexts)

      if (clearOnSubmit) {
        setMessage('')
        clearAttachedFiles()
        clearSelectedContexts()
      }

      closeMentionMenu()
    }

    const handleAbort = () => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }

    const handleTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const { value, selectionStart, selectionEnd } = event.currentTarget
      const start = selectionStart ?? value.length
      const end = selectionEnd ?? start

      handleInputChange(value, {
        start,
        end,
      })
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleMentionKeyDown(event)) {
        return
      }

      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        insertTextAtSelection('\n')
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void handleSubmit()
      }
    }

    const handleFileSelect = () => {
      if (disabled || isLoading) {
        return
      }

      fileInputRef.current?.click()
    }

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) {
        return
      }

      await processFiles(files)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const handleFileClick = (file: AttachedFile) => {
      if (file.key) {
        window.open(file.path, '_blank')
      } else if (file.previewUrl) {
        window.open(file.previewUrl, '_blank')
      }
    }

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    return (
      <div ref={containerRef} className={cn('relative flex-none', className)}>
        <div
          className={cn(
            'relative rounded-md border border-input bg-muted/40 p-2 shadow-xs transition-all duration-200 ',
            isDragging &&
            'border-primary-hover bg-yellow-50/50 dark:border-primary-hover dark:bg-yellow-950/20'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {!hideContextUsage && contextUsage && contextUsage.percentage > 0 && (
            <div className='absolute top-2 right-2 z-10'>
              <ContextUsagePill
                percentage={contextUsage.percentage}
                onCreateNewChat={() => createNewChat(workspaceId)}
              />
            </div>
          )}

          <AttachedFilesGrid
            attachedFiles={attachedFiles}
            onFileClick={handleFileClick}
            onRemoveFile={removeFile}
          />

          <div className='relative'>
            {!message && (
              <div className='pointer-events-none truncate absolute inset-x-[2px] top-1 z-[1] pr-14 font-sans text-muted-foreground text-sm leading-[1.25rem]'>
                {isDragging ? 'Drop files here...' : effectivePlaceholder}
              </div>
            )}

            <div
              ref={overlayRef}
              className='pointer-events-none absolute inset-0 z-[3] max-h-[120px] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words [&::-webkit-scrollbar]:hidden'
              style={{
                maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            >
              <pre className='m-0 whitespace-pre-wrap break-words font-sans text-foreground text-sm leading-[1.25rem]'>
                {message ? (
                  editorSegments.map((segment) =>
                    segment.type === 'mention' ? (
                      <span
                        key={segment.key}
                        className='rounded-xs text-black [-webkit-box-decoration-break:clone] [box-decoration-break:clone]'
                        style={{
                          backgroundColor: 'hsl(var(--primary-hover))',
                          boxShadow: '0 0 0 2px hsl(var(--primary-hover))',
                        }}
                      >
                        {segment.text}
                      </span>
                    ) : (
                      <span key={segment.key}>
                        {segment.text.endsWith('\n') ? `${segment.text}\u200B` : segment.text}
                      </span>
                    )
                  )
                ) : (
                  <span>{'\u00A0'}</span>
                )}
              </pre>
            </div>

            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectAdjust}
              onMouseUp={handleSelectAdjust}
              onScroll={(event) => {
                if (overlayRef.current) {
                  overlayRef.current.scrollTop = event.currentTarget.scrollTop
                  overlayRef.current.scrollLeft = event.currentTarget.scrollLeft
                }
              }}
              disabled={disabled}
              rows={1}
              className='relative z-[2] mb-2 min-h-[32px] w-full resize-none overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent py-1 pr-14 pl-[2px] font-sans text-sm text-transparent leading-[1.25rem] caret-foreground focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden'
              style={{
                maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
                wordBreak: 'break-word',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            />

            <MentionMenu
              inAggregated={inAggregated}
              loading={mentionLoading}
              mentionActiveIndex={mentionActiveIndex}
              mentionMenuRef={mentionMenuRef}
              mentionPortalRef={mentionPortalRef}
              mentionPortalStyle={mentionPortalStyle}
              mentionQuery={mentionQuery}
              menuListRef={menuListRef}
              onAggregatedItemHover={(index) => {
                setInAggregated(true)
                setSubmenuActiveIndex(index)
              }}
              onMainOptionHover={(index) => {
                setInAggregated(false)
                setMentionActiveIndex(index)
              }}
              onSelectAggregatedItem={handleAggregatedItemSelect}
              onSelectMainOption={handleMainMentionOptionSelect}
              onSelectSubmenuItem={handleSubmenuItemSelect}
              onSubmenuItemHover={setSubmenuActiveIndex}
              openSubmenuFor={openSubmenuFor}
              showMentionMenu={showMentionMenu}
              sources={mentionSources}
              submenuActiveIndex={submenuActiveIndex}
              submenuQuery={submenuQuery}
            />
          </div>

          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-1.5'>
              <AccessLevelSelector
                accessLevel={accessLevel}
                isNearTop={isNearTop}
                onAccessLevelChange={onAccessLevelChange}
              />
              <ModelSelector isNearTop={isNearTop} panelWidth={panelWidth} />
              <Button
                variant='ghost'
                size='icon'
                onClick={handleOpenMentionMenuWithAt}
                disabled={disabled || isLoading}
                className='h-6 w-6 text-muted-foreground hover:text-foreground'
                title='Insert @'
              >
                <AtSign className='h-3 w-3' />
              </Button>
            </div>

            <div className='flex items-center gap-1.5'>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleFileSelect}
                disabled={disabled || isLoading}
                className='h-6 w-6 text-muted-foreground hover:text-foreground'
                title='Attach file'
              >
                <Paperclip className='h-3 w-3' />
              </Button>

              {showAbortButton ? (
                <Button
                  onClick={handleAbort}
                  disabled={isAborting}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
                  title='Stop generation'
                >
                  {isAborting ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <X className='h-3 w-3' />
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  size='icon'
                  className='h-6 w-6 rounded-sm bg-primary-hover text-black shadow-[0_0_0_0_var(--primary-hover)] transition-all duration-200 hover:bg-primary-hover '
                >
                  {isLoading ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <Send className='h-3 w-3' />
                  )}
                </Button>
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type='file'
            onChange={handleFileChange}
            className='hidden'
            accept='image/*'
            multiple
            disabled={disabled || isLoading}
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { MessageFileAttachment, UserInputRef }
