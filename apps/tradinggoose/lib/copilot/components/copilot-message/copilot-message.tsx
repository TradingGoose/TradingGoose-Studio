'use client'

import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { extractExplicitCopilotContexts } from '@/lib/copilot/chat-contexts'
import {
  EDIT_REPLAY_BLOCKED_MESSAGE,
  hasToolActivityAfterMessage,
} from '@/lib/copilot/chat-replay-safety'
import { InlineToolCall } from '@/lib/copilot/inline-tool-call'
import type { ImagePart } from '@/lib/copilot/native/contract'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { formatCost } from '@/lib/logs/cost'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore, useCopilotStoreApi } from '@/stores/copilot/store'
import { isCopilotBusy } from '@/stores/copilot/store-state'
import type {
  ChatContext,
  CopilotDraft,
  CopilotMessage as CopilotMessageType,
  CopilotSendRuntimeContext,
} from '@/stores/copilot/types'
import { UserInput, type UserInputRef } from '../user-input/user-input'
import { buildAssistantMessageSegments } from './components/assistant-message-segments'
import { NativeFileDisplay } from './components/file-display'
import { OptionsSelector, parseSpecialTags } from './components/options-selector'
import { SmoothStreamingText, StreamingIndicator } from './components/smooth-streaming'
import { ThinkingGroup } from './components/thinking-group'

const buildMessageEditDraft = (message: CopilotMessageType): CopilotDraft => ({
  text: message.content,
  contexts: message.contexts ?? [],
})

const getMentionableContextLabels = (contexts: ChatContext[]) => {
  return Array.from(
    new Set(
      extractExplicitCopilotContexts(contexts)
        .map((context) => context?.label)
        .filter(Boolean) as string[]
    )
  ).sort((a, b) => b.length - a.length)
}

const buildContextMentionPattern = (labels: string[]) => {
  if (labels.length === 0) {
    return null
  }

  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s+)(@(?:${labels.map(escapeRegex).join('|')}))(?=\\s|$)`, 'g')
}

const renderUserMessageTextWithMentions = (text: string, contexts: ChatContext[]) => {
  const labels = getMentionableContextLabels(contexts)
  const pattern = buildContextMentionPattern(labels)

  if (!pattern) {
    return text
  }

  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1]
    const mention = match[2]
    const before = text.slice(lastIndex, match.index)

    if (before) {
      nodes.push(before)
    }

    if (prefix) {
      nodes.push(prefix)
    }

    nodes.push(
      <span
        key={`mention-${match.index}-${lastIndex}`}
        className='rounded-xs text-black [-webkit-box-decoration-break:clone] [box-decoration-break:clone]'
        style={{
          backgroundColor: 'hsl(var(--primary-hover))',
          boxShadow: '0 0 0 2px hsl(var(--primary-hover))',
        }}
      >
        {mention}
      </span>
    )

    lastIndex = match.index + match[0].length
  }

  const tail = text.slice(lastIndex)
  if (tail) {
    nodes.push(tail)
  }

  return nodes.length > 0 ? nodes : text
}

interface CopilotMessageProps {
  message: CopilotMessageType
  runtimeContext: CopilotSendRuntimeContext
  isStreaming: boolean
  panelWidth: number
  isDimmed: boolean
  onEditModeChange: (isEditing: boolean) => void
}

const CopilotMessage: FC<CopilotMessageProps> = memo(
  ({ message, runtimeContext, isStreaming, panelWidth, isDimmed, onEditModeChange }) => {
    const copilotCopy = useCopilotMessages()
    const isUser = message.role === 'user'
    const isAssistant = message.role === 'assistant'
    const [isEditMode, setIsEditMode] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [editDraft, setEditDraft] = useState<CopilotDraft>(() => buildMessageEditDraft(message))
    const [editBlockedReason, setEditBlockedReason] = useState<string | null>(null)
    const [isHoveringMessage, setIsHoveringMessage] = useState(false)
    const editContainerRef = useRef<HTMLDivElement>(null)
    const messageContentRef = useRef<HTMLDivElement>(null)
    const userInputRef = useRef<UserInputRef>(null)
    const [needsExpansion, setNeedsExpansion] = useState(false)
    const [typingSegmentKeys, setTypingSegmentKeys] = useState<string[]>([])

    const state = useCopilotStore()
    const {
      currentChat,
      currentRunId,
      messages,
      sendMessage,
      isSendingMessage,
      isAborting,
      abortMessage,
    } = state
    const copilotStoreApi = useCopilotStoreApi()

    // Check if this is the last user message (for showing abort button)
    const isLastUserMessage = useMemo(() => {
      if (!isUser) return false
      const userMessages = messages.filter((m) => m.role === 'user')
      return userMessages.length > 0 && userMessages[userMessages.length - 1]?.id === message.id
    }, [isUser, messages, message.id])

    const isLastMessage = useMemo(() => {
      if (messages.length === 0) return false
      return messages[messages.length - 1]?.id === message.id
    }, [messages, message.id])

    const isTurnInProgress = isStreaming || isCopilotBusy(state)
    const isMessageTyping = typingSegmentKeys.length > 0
    const shouldHidePostTurnControls = isTurnInProgress || isMessageTyping
    const shouldShowActivityIndicator =
      isAssistant && isLastMessage && isTurnInProgress && !isMessageTyping
    const userMessageText = message.content
    const hasNativeFiles = message.contentBlocks?.some((block) => block.type === 'file') ?? false
    const userMessageContexts = extractExplicitCopilotContexts(message.contexts)

    const isReplayBlockedForEdit = useMemo(
      () => hasToolActivityAfterMessage(messages, message.id),
      [message.id, messages]
    )

    const handleEditMessage = () => {
      if (isSendingMessage && !currentRunId) {
        setEditBlockedReason('Wait for the response to start before editing this message.')
        return
      }
      if (isReplayBlockedForEdit) {
        setIsEditMode(false)
        setEditBlockedReason(EDIT_REPLAY_BLOCKED_MESSAGE)
        onEditModeChange(false)
        return
      }

      setIsEditMode(true)
      setIsExpanded(false)
      setEditDraft(buildMessageEditDraft(message))
      setEditBlockedReason(null)
      onEditModeChange(true)
      // Focus the input and position cursor at the end after render
      setTimeout(() => {
        userInputRef.current?.focus()
      }, 0)
    }

    const handleCancelEdit = () => {
      setIsEditMode(false)
      setEditDraft(buildMessageEditDraft(message))
      onEditModeChange(false)
    }

    const handleMessageClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest('[data-native-image]')) return
      // Allow entering edit mode even while streaming

      // If message needs expansion and is not expanded, expand it
      if (needsExpansion && !isExpanded) {
        setIsExpanded(true)
      }

      // Always enter edit mode on click
      handleEditMessage()
    }

    const handleSubmitEdit = async (
      editedMessage: string,
      images?: ImagePart[],
      contexts?: ChatContext[]
    ) => {
      if (!editedMessage.trim()) return false
      if (isSendingMessage && !currentRunId) {
        setEditBlockedReason('Wait for the response to start before editing this message.')
        return false
      }

      if (isReplayBlockedForEdit) {
        handleCancelEdit()
        setEditBlockedReason(EDIT_REPLAY_BLOCKED_MESSAGE)
        return false
      }

      // If a stream is in progress, abort it first
      if (isTurnInProgress) {
        if (!(await abortMessage())) {
          setEditBlockedReason(
            copilotStoreApi.getState().error || 'The current response could not be stopped.'
          )
          return false
        }
      }

      // Proceed with the edit
      return performEdit(editedMessage, images, contexts)
    }

    const performEdit = async (
      editedMessage: string,
      images?: ImagePart[],
      contexts?: ChatContext[]
    ) => {
      if (
        images?.length ||
        message.contentBlocks?.some((block) => block.type === 'file') ||
        stableStringifyJsonValue(contexts ?? []) !==
          stableStringifyJsonValue(message.contexts ?? [])
      ) {
        setEditBlockedReason(
          'Native history editing accepts text only; attachments and contexts were retained.'
        )
        return false
      }
      try {
        const completed = await sendMessage(editedMessage, {
          messageId: message.id,
          contexts,
          runtimeContext,
        })
        if (!completed)
          throw new Error(
            copilotStoreApi.getState().error || 'Copilot regeneration did not complete'
          )
        setIsEditMode(false)
        setEditBlockedReason(null)
        onEditModeChange(false)
        return true
      } catch (error) {
        setEditBlockedReason(error instanceof Error ? error.message : 'Native history edit failed')
        return false
      }
    }

    useEffect(() => {
      if (!editBlockedReason) {
        return
      }

      const timeoutId = window.setTimeout(() => {
        setEditBlockedReason(null)
      }, 4000)

      return () => window.clearTimeout(timeoutId)
    }, [editBlockedReason])

    // Handle click outside to exit edit mode
    useEffect(() => {
      if (!isEditMode) return

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement

        // Don't close if clicking inside the edit container
        if (editContainerRef.current?.contains(target)) {
          return
        }

        // Check if clicking on another user message box
        const clickedMessageBox = target.closest('[data-message-box]') as HTMLElement
        if (clickedMessageBox) {
          const clickedMessageId = clickedMessageBox.getAttribute('data-message-id')
          // If clicking on a different message, close this one (the other will open via its own click handler)
          if (clickedMessageId && clickedMessageId !== message.id) {
            handleCancelEdit()
          }
          return
        }

        // Check if clicking on the main user input at the bottom
        if (target.closest('textarea') || target.closest('input[type="text"]')) {
          handleCancelEdit()
          return
        }

        // Only close if NOT clicking on any component (i.e., clicking directly on panel background)
        // If the target has children or is a component, don't close
        if (target.children.length > 0 || target.tagName !== 'DIV') {
          return
        }

        handleCancelEdit()
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          handleCancelEdit()
        }
      }

      // Use click event instead of mousedown to allow the target's click handler to fire first
      // Add listener with a slight delay to avoid immediate trigger when entering edit mode
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside, true) // Use capture phase
        document.addEventListener('keydown', handleKeyDown)
      }, 100)

      return () => {
        clearTimeout(timeoutId)
        document.removeEventListener('click', handleClickOutside, true)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }, [isEditMode, message.id])

    // Check if message content needs expansion (is tall)
    useEffect(() => {
      if (messageContentRef.current && isUser) {
        const scrollHeight = messageContentRef.current.scrollHeight
        // If content is taller than the max height (3 lines ~60px), mark as needing expansion
        setNeedsExpansion(scrollHeight > 60)
      }
    }, [message.content, isUser])

    // Parse selectable options from message content.
    // Parse during streaming to show options as they stream in
    const parsedTags = useMemo(() => {
      if (isUser) return null

      if (message.content) {
        const parsed = parseSpecialTags(message.content)
        if (parsed.options) return parsed
      }

      if (isStreaming && message.contentBlocks && message.contentBlocks.length > 0) {
        for (const block of message.contentBlocks) {
          if (block.type === 'text' && block.content) {
            const parsed = parseSpecialTags(block.content)
            if (parsed.options) return parsed
          }
        }
      }

      return message.content ? parseSpecialTags(message.content) : null
    }, [message.content, message.contentBlocks, isUser, isStreaming])

    const handleOptionSelect = useCallback(
      (_optionKey: string, optionText: string) => {
        sendMessage(optionText, { runtimeContext })
      },
      [runtimeContext, sendMessage]
    )

    const assistantSegments = useMemo(() => {
      if (!message.contentBlocks || message.contentBlocks.length === 0) {
        return null
      }

      return buildAssistantMessageSegments(message.contentBlocks)
    }, [message.contentBlocks])

    const visibleAssistantSegments = useMemo(() => {
      if (!assistantSegments) {
        return null
      }

      if (typingSegmentKeys.length === 0) {
        return assistantSegments
      }

      const typingKeySet = new Set(typingSegmentKeys)
      const visibleSegments = []

      for (const segment of assistantSegments) {
        visibleSegments.push(segment)
        if (segment.type === 'text' && typingKeySet.has(segment.key)) {
          break
        }
      }

      return visibleSegments
    }, [assistantSegments, typingSegmentKeys])

    const handleTypingStateChange = useCallback((typingKey: string, isTyping: boolean) => {
      setTypingSegmentKeys((currentKeys) => {
        const hasKey = currentKeys.includes(typingKey)
        if (isTyping) {
          return hasKey ? currentKeys : [...currentKeys, typingKey]
        }
        return hasKey ? currentKeys.filter((key) => key !== typingKey) : currentKeys
      })
    }, [])

    // Memoize content blocks to avoid re-rendering unchanged blocks
    const memoizedContentBlocks = useMemo(() => {
      if (!visibleAssistantSegments) {
        return null
      }

      return visibleAssistantSegments.map((segment, index) => {
        if (segment.type === 'text') {
          const block = segment.block
          const isLastTextBlock = index === visibleAssistantSegments.length - 1
          // Clean content for this text block and strip special tags
          const parsed = parseSpecialTags(block.content)
          const cleanBlockContent = parsed.cleanContent.replace(/\n{3,}/g, '\n\n')

          if (!cleanBlockContent.trim()) return null

          return (
            <div
              key={segment.key}
              className='w-full max-w-full overflow-hidden transition-opacity duration-200 ease-in-out'
              style={{
                opacity: cleanBlockContent.length > 0 ? 1 : 0.7,
                transform: isLastTextBlock ? 'translateY(0)' : undefined,
                transition: isLastTextBlock
                  ? 'transform 0.1s ease-out, opacity 0.2s ease-in-out'
                  : 'opacity 0.2s ease-in-out',
              }}
            >
              <SmoothStreamingText
                content={cleanBlockContent}
                typingKey={segment.key}
                onTypingStateChange={handleTypingStateChange}
              />
            </div>
          )
        }
        if (segment.type === 'thinking') {
          const isStreamingThinking = Boolean(isStreaming)

          return (
            <div
              key={segment.key}
              className='fade-in-0 slide-in-from-top-2 w-full animate-in transition-opacity duration-200 ease-out'
            >
              <ThinkingGroup blocks={segment.blocks} isStreaming={isStreamingThinking} />
            </div>
          )
        }
        if (segment.type === 'tool_call') {
          const block = segment.block
          // Visibility and filtering handled by InlineToolCall
          return (
            <div
              key={segment.key}
              className='fade-in-0 slide-in-from-top-2 animate-in transition-opacity duration-200 ease-out'
              style={{ opacity: 1 }}
            >
              <InlineToolCall toolCallId={block.toolCall.id} toolCall={block.toolCall} />
            </div>
          )
        }
        if (segment.type === 'file')
          return <NativeFileDisplay key={segment.key} file={segment.block.file} />
        return null
      })
    }, [handleTypingStateChange, isStreaming, visibleAssistantSegments])

    if (isUser) {
      return (
        <div
          className={`w-full min-w-0 max-w-full overflow-hidden py-0.5 transition-opacity duration-200 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
        >
          {editBlockedReason && (
            <div
              role='alert'
              className='mb-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive text-xs'
            >
              {editBlockedReason}
            </div>
          )}
          {isEditMode ? (
            <div ref={editContainerRef} className='relative w-full'>
              <UserInput
                ref={userInputRef}
                workspaceId={currentChat?.workspaceId ?? ''}
                onSubmit={handleSubmitEdit}
                draft={editDraft}
                onDraftChange={setEditDraft}
                placeholder={copilotCopy.message.editPlaceholder}
                panelWidth={panelWidth}
                clearOnSubmit={false}
                isLoading={isAborting}
              />
            </div>
          ) : (
            <div className='w-full min-w-0'>
              {/* Message box - styled like input, clickable to edit */}
              <div
                data-message-box
                data-message-id={message.id}
                onClick={handleMessageClick}
                onMouseEnter={() => setIsHoveringMessage(true)}
                onMouseLeave={() => setIsHoveringMessage(false)}
                className='group relative min-w-0 cursor-text rounded-md border border-input bg-muted/40 px-3 py-1.5 shadow-xs transition-all duration-200'
              >
                <div
                  ref={messageContentRef}
                  className={`min-w-0 whitespace-pre-wrap break-words py-1 pl-[2px] font-sans text-foreground text-sm leading-[1.25rem] ${isSendingMessage && isLastUserMessage ? 'pr-10' : 'pr-2'}`}
                  style={{
                    maxHeight: !hasNativeFiles && !isExpanded && needsExpansion ? '60px' : 'none',
                    overflow:
                      !hasNativeFiles && !isExpanded && needsExpansion ? 'hidden' : 'visible',
                    position: 'relative',
                  }}
                >
                  {hasNativeFiles
                    ? message.contentBlocks?.map((block, index) =>
                        block.type === 'file' ? (
                          <NativeFileDisplay key={`file-${index}`} file={block.file} />
                        ) : block.type === 'text' ? (
                          <span key={`text-${index}`}>
                            {renderUserMessageTextWithMentions(block.content, userMessageContexts)}
                          </span>
                        ) : null
                      )
                    : renderUserMessageTextWithMentions(userMessageText, userMessageContexts)}
                </div>
                {/* Gradient fade when truncated */}
                {!hasNativeFiles && !isExpanded && needsExpansion && (
                  <div className='absolute right-0 bottom-0 left-0 h-full rounded-b-lg bg-gradient-to-t from-background/60 to-transparent' />
                )}
                {/* Abort button when hovering and response is generating (only on last user message) */}
                {isTurnInProgress && isHoveringMessage && isLastUserMessage && (
                  <div className='absolute right-2 bottom-2'>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type='button'
                            onClick={(e) => {
                              e.stopPropagation()
                              abortMessage()
                            }}
                            disabled={isAborting}
                            className='flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60'
                            aria-label={copilotCopy.message.stopGeneration}
                          >
                            <X className='h-4 w-4' />
                          </button>
                        }
                      />
                      <TooltipContent side='top'>
                        {copilotCopy.message.stopGeneration}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )
    }

    if (isAssistant) {
      return (
        <div
          className={`w-full max-w-full overflow-hidden pb-2 pl-[2px] transition-opacity duration-200 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
          role={message.isError ? 'alert' : undefined}
          aria-atomic={message.isError ? 'true' : undefined}
        >
          <div className='max-w-full space-y-1.5 transition-all duration-200 ease-in-out'>
            {/* Content blocks in chronological order */}
            {memoizedContentBlocks}

            {shouldShowActivityIndicator && <StreamingIndicator />}

            {(message.usage || message.cost) && (
              <div
                className='flex flex-wrap gap-x-2 pt-1 text-muted-foreground text-xs'
                data-testid='message-usage'
              >
                {message.usage && (
                  <span
                    title={`Input: ${message.usage.inputTokens ?? 'Unavailable'}; output: ${message.usage.outputTokens ?? 'Unavailable'}`}
                  >
                    {message.usage.totalTokens?.toLocaleString() ?? 'Unavailable'} tokens
                  </span>
                )}
                {message.cost && (
                  <span>
                    {message.cost.total !== undefined &&
                    (message.cost.estimated || message.cost.status === 'estimated')
                      ? 'Estimated '
                      : ''}
                    {formatCost(message.cost.total)} USD
                    {message.cost.status === 'partial' &&
                      message.cost.availableTotal !== undefined &&
                      ` (${message.cost.estimated ? 'estimated ' : ''}${formatCost(message.cost.availableTotal)} available)`}
                  </span>
                )}
              </div>
            )}

            {/* Options selector after the full assistant message has finished rendering */}
            {(() => {
              const options = parsedTags?.options
              const isOptionsReady =
                !shouldHidePostTurnControls && parsedTags?.optionsComplete === true

              if (!isLastMessage || !options || !isOptionsReady) return null

              return <OptionsSelector options={options} onSelect={handleOptionSelect} />
            })()}
          </div>
        </div>
      )
    }

    return null
  }
)

CopilotMessage.displayName = 'CopilotMessage'

export { CopilotMessage }
