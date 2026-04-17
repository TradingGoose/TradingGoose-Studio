'use client'

import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Blocks,
  BookOpen,
  Bot,
  Box,
  Check,
  Clipboard,
  Info,
  LibraryBig,
  Shapes,
  SquareChevronRight,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  X,
} from 'lucide-react'
import { isHiddenCopilotContext } from '@/lib/copilot/chat-contexts'
import {
  EDIT_REPLAY_BLOCKED_MESSAGE,
  hasAcceptedLiveMutationAfterMessage,
} from '@/lib/copilot/chat-replay-safety'
import { InlineToolCall } from '@/lib/copilot/inline-tool-call'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore, useCopilotStoreApi } from '@/stores/copilot/store'
import type { ChatContext, CopilotMessage as CopilotMessageType } from '@/stores/copilot/types'
import { UserInput, type UserInputRef } from '../user-input/user-input'
import {
  buildAssistantMessageSegments,
  FileAttachmentDisplay,
  OptionsSelector,
  parseSpecialTags,
  SmoothStreamingText,
  StreamingIndicator,
  ThinkingGroup,
} from './components'
import { shouldRenderAssistantOptions } from './message-visibility'

const logger = createLogger('CopilotMessage')
const WORKFLOW_TOOL_NAMES = ['edit_workflow'] as const

interface CopilotMessageProps {
  message: CopilotMessageType
  isStreaming?: boolean
  panelWidth?: number
  isDimmed?: boolean
  onEditModeChange?: (isEditing: boolean) => void
}

const CopilotMessage: FC<CopilotMessageProps> = memo(
  ({ message, isStreaming, panelWidth = 308, isDimmed = false, onEditModeChange }) => {
    const isUser = message.role === 'user'
    const isAssistant = message.role === 'assistant'
    const [showCopySuccess, setShowCopySuccess] = useState(false)
    const [showUpvoteSuccess, setShowUpvoteSuccess] = useState(false)
    const [showDownvoteSuccess, setShowDownvoteSuccess] = useState(false)
    const [showAllContexts, setShowAllContexts] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [editedContent, setEditedContent] = useState(message.content)
    const [editBlockedReason, setEditBlockedReason] = useState<string | null>(null)
    const [isHoveringMessage, setIsHoveringMessage] = useState(false)
    const editContainerRef = useRef<HTMLDivElement>(null)
    const messageContentRef = useRef<HTMLDivElement>(null)
    const userInputRef = useRef<UserInputRef>(null)
    const [needsExpansion, setNeedsExpansion] = useState(false)
    const [typingSegmentKeys, setTypingSegmentKeys] = useState<string[]>([])

    const {
      currentChat,
      messages,
      sendMessage,
      isSendingMessage,
      abortMessage,
      accessLevel,
      setAccessLevel,
    } = useCopilotStore()
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

    const isLatestTurnInProgress =
      isLastMessage &&
      (isStreaming || isSendingMessage || currentChat?.latestTurnStatus === 'in_progress')
    const isMessageTyping = typingSegmentKeys.length > 0

    const isReplayBlockedForEdit = useMemo(
      () => hasAcceptedLiveMutationAfterMessage(messages, message.id),
      [message.id, messages]
    )

    const handleCopyContent = () => {
      // Copy clean text content
      const textToCopy = cleanTextContent || message.content || ''
      navigator.clipboard.writeText(textToCopy)
      setShowCopySuccess(true)
    }

    // Helper function to get the full assistant response content
    const getFullAssistantContent = (message: CopilotMessageType) => {
      // First try the direct content
      if (message.content?.trim()) {
        return message.content
      }

      // If no direct content, build from content blocks
      if (message.contentBlocks && message.contentBlocks.length > 0) {
        return message.contentBlocks
          .filter((block) => block.type === 'text')
          .map((block) => block.content)
          .join('')
      }

      return message.content || ''
    }

    // Helper function to find the last user query before this assistant message
    const getLastUserQuery = () => {
      const messageIndex = messages.findIndex((msg) => msg.id === message.id)
      if (messageIndex === -1) return null

      // Look backwards from this message to find the last user message
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          return messages[i].content
        }
      }
      return null
    }

    // Helper function to extract the current workflow document from workflow tool calls
    const getWorkflowDocument = () => {
      const allToolCalls = [
        ...(message.toolCalls || []),
        ...(message.contentBlocks || [])
          .filter((block) => block.type === 'tool_call')
          .map((block) => (block as any).toolCall),
      ]

      // Find workflow tools (edit_workflow)
      const workflowTools = allToolCalls.filter((toolCall) =>
        WORKFLOW_TOOL_NAMES.includes(toolCall?.name)
      )

      // Extract workflow document content from workflow tools in the current message
      for (const toolCall of workflowTools) {
        const workflowDocument =
          toolCall.result?.workflowDocument ||
          toolCall.result?.data?.workflowDocument ||
          toolCall.input?.workflowDocument ||
          toolCall.input?.data?.workflowDocument

        if (workflowDocument && typeof workflowDocument === 'string' && workflowDocument.trim()) {
          return workflowDocument
        }
      }

      return null
    }

    // Function to submit feedback
    const submitFeedback = async (isPositive: boolean) => {
      // Ensure we have a chat ID
      if (!currentChat?.reviewSessionId) {
        logger.error('No current chat ID available for feedback submission')
        return
      }

      const userQuery = getLastUserQuery()
      if (!userQuery) {
        logger.error('No user query found for feedback submission')
        return
      }

      const agentResponse = getFullAssistantContent(message)
      if (!agentResponse.trim()) {
        logger.error('No agent response content available for feedback submission')
        return
      }

      const workflowDocument = getWorkflowDocument()

      try {
        const requestBody: any = {
          reviewSessionId: currentChat.reviewSessionId,
          userQuery,
          agentResponse,
          isPositiveFeedback: isPositive,
        }

        if (workflowDocument) {
          requestBody.workflowYaml = workflowDocument
        }

        const response = await fetch('/api/copilot/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          throw new Error(`Failed to submit feedback: ${response.statusText}`)
        }

        await response.json()
      } catch (error) {
        logger.error('Error submitting feedback:', error)
      }
    }

    const handleUpvote = async () => {
      // Reset downvote if it was active
      setShowDownvoteSuccess(false)
      setShowUpvoteSuccess(true)

      // Submit positive feedback
      await submitFeedback(true)
    }

    const handleDownvote = async () => {
      // Reset upvote if it was active
      setShowUpvoteSuccess(false)
      setShowDownvoteSuccess(true)

      // Submit negative feedback
      await submitFeedback(false)
    }

    const handleEditMessage = () => {
      if (isReplayBlockedForEdit) {
        setIsEditMode(false)
        setEditBlockedReason(EDIT_REPLAY_BLOCKED_MESSAGE)
        onEditModeChange?.(false)
        return
      }

      setIsEditMode(true)
      setIsExpanded(false)
      setEditedContent(message.content)
      setEditBlockedReason(null)
      onEditModeChange?.(true)
      // Focus the input and position cursor at the end after render
      setTimeout(() => {
        userInputRef.current?.focus()
      }, 0)
    }

    const handleCancelEdit = () => {
      setIsEditMode(false)
      setEditedContent(message.content)
      onEditModeChange?.(false)
    }

    const handleMessageClick = () => {
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
      fileAttachments?: any[],
      contexts?: any[]
    ) => {
      if (!editedMessage.trim()) return

      if (isReplayBlockedForEdit) {
        handleCancelEdit()
        setEditBlockedReason(EDIT_REPLAY_BLOCKED_MESSAGE)
        return
      }

      // If a stream is in progress, abort it first
      if (isSendingMessage) {
        abortMessage()
        // Wait a brief moment for abort to complete
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Proceed with the edit
      await performEdit(editedMessage, fileAttachments, contexts)
    }

    const performEdit = async (
      editedMessage: string,
      fileAttachments?: any[],
      contexts?: any[]
    ) => {
      // Find the index of this message and truncate conversation
      const currentMessages = messages
      const editIndex = currentMessages.findIndex((m) => m.id === message.id)

      if (editIndex !== -1) {
        // Truncate messages after the edited message (but keep the edited message with updated content)
        const truncatedMessages = currentMessages.slice(0, editIndex)

        // Update the edited message with new content but keep it in the array
        const updatedMessage = {
          ...message,
          content: editedMessage,
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: (contexts || (message as any).contexts) as ChatContext[] | undefined,
        }

        // If we have a current chat, update the DB to remove messages after this point
        if (currentChat?.reviewSessionId) {
          try {
            const response = await fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reviewSessionId: currentChat.reviewSessionId,
                messages: truncatedMessages.map((m) => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  ...(m.contentBlocks && { contentBlocks: m.contentBlocks }),
                  ...(m.fileAttachments && { fileAttachments: m.fileAttachments }),
                  ...((m as any).contexts && { contexts: (m as any).contexts }),
                })),
              }),
            })

            if (!response.ok) {
              let errorMessage = 'Failed to update messages in DB after edit'

              try {
                const payload = await response.json()
                if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
                  errorMessage = payload.error
                }
              } catch {}

              if (response.status === 409) {
                handleCancelEdit()
                setEditBlockedReason(errorMessage)
                return
              }

              throw new Error(errorMessage)
            }
          } catch (error) {
            logger.error('Failed to update messages in DB after edit:', error)
            return
          }
        }

        // Exit edit mode visually
        setIsEditMode(false)
        setEditBlockedReason(null)
        // Clear editing state in parent immediately to prevent dimming of new messages
        onEditModeChange?.(false)

        // Show the updated message immediately to prevent disappearing
        copilotStoreApi.setState({ messages: [...truncatedMessages, updatedMessage] })

        // Send the edited message with the SAME message ID
        await sendMessage(editedMessage, {
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: (contexts || (message as any).contexts) as ChatContext[] | undefined,
          messageId: message.id, // Reuse the original message ID
        })
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

    useEffect(() => {
      if (showCopySuccess) {
        const timer = setTimeout(() => {
          setShowCopySuccess(false)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }, [showCopySuccess])

    useEffect(() => {
      if (showUpvoteSuccess) {
        const timer = setTimeout(() => {
          setShowUpvoteSuccess(false)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }, [showUpvoteSuccess])

    useEffect(() => {
      if (showDownvoteSuccess) {
        const timer = setTimeout(() => {
          setShowDownvoteSuccess(false)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }, [showDownvoteSuccess])

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

    // Parse special tags from message content (options, plan)
    // Parse during streaming to show options as they stream in
    const parsedTags = useMemo(() => {
      if (isUser) return null

      if (message.content) {
        const parsed = parseSpecialTags(message.content)
        if (parsed.options || parsed.plan) return parsed
      }

      if (isStreaming && message.contentBlocks && message.contentBlocks.length > 0) {
        for (const block of message.contentBlocks) {
          if (block.type === 'text' && block.content) {
            const parsed = parseSpecialTags(block.content)
            if (parsed.options || parsed.plan) return parsed
          }
        }
      }

      return message.content ? parseSpecialTags(message.content) : null
    }, [message.content, message.contentBlocks, isUser, isStreaming])

    const handleOptionSelect = useCallback(
      (_optionKey: string, optionText: string) => {
        sendMessage(optionText)
      },
      [sendMessage]
    )

    // Get clean text content with double newline parsing
    const cleanTextContent = useMemo(() => {
      if (!message.content) return ''

      // Parse out excessive newlines (more than 2 consecutive newlines)
      const normalized = message.content.replace(/\n{3,}/g, '\n\n')
      if (!isAssistant) return normalized

      if (parsedTags) {
        return parsedTags.cleanContent.replace(/\n{3,}/g, '\n\n')
      }

      return normalized
    }, [message.content, isAssistant, parsedTags])

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

    useEffect(() => {
      const activeTextSegmentKeys = new Set(
        assistantSegments
          ?.filter((segment) => segment.type === 'text')
          .map((segment) => segment.key) ?? []
      )

      setTypingSegmentKeys((currentKeys) =>
        currentKeys.filter((key) => activeTextSegmentKeys.has(key))
      )
    }, [assistantSegments])

    // Memoize content blocks to avoid re-rendering unchanged blocks
    const memoizedContentBlocks = useMemo(() => {
      if (!visibleAssistantSegments) {
        return null
      }

      return visibleAssistantSegments.map((segment, index) => {
        if (segment.type === 'text') {
          const block = segment.block
          const isLastTextBlock =
            index === visibleAssistantSegments.length - 1 && segment.type === 'text'
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
                isStreaming={isStreaming}
                typingKey={segment.key}
                onTypingStateChange={handleTypingStateChange}
              />
            </div>
          )
        }
        if (segment.type === 'thinking') {
          const isStreamingThinking =
            isStreaming && segment.blocks.some((block) => block.duration == null)

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
        return null
      })
    }, [handleTypingStateChange, isStreaming, visibleAssistantSegments])

    if (isUser) {
      return (
        <div
          className={`w-full min-w-0 max-w-full overflow-hidden py-0.5 transition-opacity duration-200 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
        >
          {isEditMode ? (
            <div ref={editContainerRef} className='relative w-full'>
              <UserInput
                ref={userInputRef}
                workspaceId={currentChat?.workspaceId ?? ''}
                onSubmit={handleSubmitEdit}
                onAbort={handleCancelEdit}
                isLoading={isSendingMessage && isLastUserMessage}
                disabled={false}
                value={editedContent}
                onChange={setEditedContent}
                placeholder='Edit your message...'
                accessLevel={accessLevel}
                onAccessLevelChange={setAccessLevel}
                panelWidth={panelWidth}
                hideContextUsage={true}
                clearOnSubmit={false}
              />
            </div>
          ) : (
            <div className='w-full min-w-0'>
              {editBlockedReason && (
                <div className='mb-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive text-xs'>
                  {editBlockedReason}
                </div>
              )}

              {/* File attachments displayed above the message box */}
              {message.fileAttachments && message.fileAttachments.length > 0 && (
                <div className='mb-1.5 flex flex-wrap gap-1.5'>
                  <FileAttachmentDisplay fileAttachments={message.fileAttachments} />
                </div>
              )}

              {/* Context chips displayed above the message box */}
              {(Array.isArray((message as any).contexts) && (message as any).contexts.length > 0) ||
              (Array.isArray(message.contentBlocks) &&
                (message.contentBlocks as any[]).some((b: any) => b?.type === 'contexts')) ? (
                <div className='mb-1.5 flex flex-wrap gap-1.5'>
                  {(() => {
                    const direct = Array.isArray((message as any).contexts)
                      ? ((message as any).contexts as any[])
                      : []
                    const block = Array.isArray(message.contentBlocks)
                      ? (message.contentBlocks as any[]).find((b: any) => b?.type === 'contexts')
                      : null
                    const fromBlock = Array.isArray((block as any)?.contexts)
                      ? ((block as any).contexts as any[])
                      : []
                    const allContexts = (direct.length > 0 ? direct : fromBlock).filter(
                      (context: any) => !isHiddenCopilotContext(context)
                    )
                    const MAX_VISIBLE = 4
                    const visible = showAllContexts
                      ? allContexts
                      : allContexts.slice(0, MAX_VISIBLE)
                    return (
                      <>
                        {visible.map((ctx: any, idx: number) => (
                          <span
                            key={`ctx-${idx}-${ctx?.label || ctx?.kind}`}
                            className='inline-flex items-center gap-1 rounded-full bg-primary-hover/20 px-1.5 py-0.5 text-foreground text-xs'
                            title={ctx?.label || ctx?.kind}
                          >
                            {ctx?.kind === 'past_chat' ? (
                              <Bot className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'workflow' || ctx?.kind === 'current_workflow' ? (
                              <Workflow className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'blocks' ? (
                              <Blocks className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'workflow_block' ? (
                              <Box className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'knowledge' ? (
                              <LibraryBig className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'templates' ? (
                              <Shapes className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'docs' ? (
                              <BookOpen className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'logs' ? (
                              <SquareChevronRight className='h-3 w-3 text-muted-foreground' />
                            ) : (
                              <Info className='h-3 w-3 text-muted-foreground' />
                            )}
                            <span className='max-w-[140px] truncate'>
                              {ctx?.label || ctx?.kind}
                            </span>
                          </span>
                        ))}
                        {allContexts.length > MAX_VISIBLE && (
                          <button
                            type='button'
                            onClick={() => setShowAllContexts((v) => !v)}
                            className='inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary-hover)_10%,transparent)] px-1.5 py-0.5 text-[11px] text-foreground hover:bg-[color-mix(in_srgb,var(--primary-hover)_14%,transparent)]'
                            title={
                              showAllContexts
                                ? 'Show less'
                                : `Show ${allContexts.length - MAX_VISIBLE} more`
                            }
                          >
                            {showAllContexts
                              ? 'Show less'
                              : `+${allContexts.length - MAX_VISIBLE} more`}
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>
              ) : null}

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
                    maxHeight: !isExpanded && needsExpansion ? '60px' : 'none',
                    overflow: !isExpanded && needsExpansion ? 'hidden' : 'visible',
                    position: 'relative',
                  }}
                >
                  {(() => {
                    const text = message.content || ''
                    const contexts: any[] = Array.isArray((message as any).contexts)
                      ? ((message as any).contexts as any[])
                      : []
                    const labels = contexts
                      .filter((context) => !isHiddenCopilotContext(context))
                      .map((c) => c?.label)
                      .filter(Boolean) as string[]
                    if (!labels.length) return text

                    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    const pattern = new RegExp(`@(${labels.map(escapeRegex).join('|')})`, 'g')

                    const nodes: React.ReactNode[] = []
                    let lastIndex = 0
                    let match: RegExpExecArray | null
                    while ((match = pattern.exec(text)) !== null) {
                      const i = match.index
                      const before = text.slice(lastIndex, i)
                      if (before) nodes.push(before)
                      const mention = match[0]
                      nodes.push(
                        <span
                          key={`mention-${i}-${lastIndex}`}
                          className='rounded-sm bg-[color-mix(in_srgb,var(--primary-hover)_14%,transparent)] px-1'
                        >
                          {mention}
                        </span>
                      )
                      lastIndex = i + mention.length
                    }
                    const tail = text.slice(lastIndex)
                    if (tail) nodes.push(tail)
                    return nodes
                  })()}
                </div>
                {/* Gradient fade when truncated */}
                {!isExpanded && needsExpansion && (
                  <div className='absolute right-0 bottom-0 left-0 h-full rounded-b-lg bg-gradient-to-t from-background/60 to-transparent' />
                )}
                {/* Abort button when hovering and response is generating (only on last user message) */}
                {isSendingMessage && isHoveringMessage && isLastUserMessage && (
                  <div className='absolute right-2 bottom-2'>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        abortMessage()
                      }}
                      className='flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
                      title='Stop generation'
                    >
                      <X className='h-3 w-3' />
                    </button>
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
          className={`w-full max-w-full overflow-hidden py-0.5 pl-[2px] transition-opacity duration-200 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
        >
          <div className='max-w-full space-y-1.5 transition-all duration-200 ease-in-out'>
            {/* Content blocks in chronological order */}
            {memoizedContentBlocks}

            {/* Show streaming indicator if streaming but no text content yet after tool calls */}
            {isStreaming &&
              !message.content &&
              message.contentBlocks?.every((block) => block.type === 'tool_call') && (
                <StreamingIndicator />
              )}

            {/* Streaming indicator when no content yet */}
            {!cleanTextContent && !message.contentBlocks?.length && isStreaming && (
              <StreamingIndicator />
            )}

            {/* Action buttons for completed messages */}
            {!isLatestTurnInProgress && !isMessageTyping && cleanTextContent && (
              <div className='flex items-center gap-1'>
                <button
                  onClick={handleCopyContent}
                  className='text-muted-foreground transition-colors hover:bg-card'
                  title='Copy'
                >
                  {showCopySuccess ? (
                    <Check className='h-3 w-3' strokeWidth={2} />
                  ) : (
                    <Clipboard className='h-3 w-3' strokeWidth={2} />
                  )}
                </button>
                <button
                  onClick={handleUpvote}
                  className='text-muted-foreground transition-colors hover:bg-card'
                  title='Upvote'
                >
                  {showUpvoteSuccess ? (
                    <Check className='h-3 w-3' strokeWidth={2} />
                  ) : (
                    <ThumbsUp className='h-3 w-3' strokeWidth={2} />
                  )}
                </button>
                <button
                  onClick={handleDownvote}
                  className='text-muted-foreground transition-colors hover:bg-card'
                  title='Downvote'
                >
                  {showDownvoteSuccess ? (
                    <Check className='h-3 w-3' strokeWidth={2} />
                  ) : (
                    <ThumbsDown className='h-3 w-3' strokeWidth={2} />
                  )}
                </button>
              </div>
            )}

            {/* Citations if available */}
            {message.citations && message.citations.length > 0 && (
              <div className='pt-1'>
                <div className='font-medium text-muted-foreground text-xs'>Sources:</div>
                <div className='flex flex-wrap gap-2'>
                  {message.citations.map((citation) => (
                    <a
                      key={citation.id}
                      href={citation.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex max-w-full items-center rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-card hover:text-foreground'
                    >
                      <span className='truncate'>{citation.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Options selector when agent presents choices - streams in but disabled until complete */}
            {(() => {
              const options = parsedTags?.options
              const shouldRenderOptions = shouldRenderAssistantOptions({
                role: message.role,
                isLastMessage,
                hasOptions: Boolean(options && Object.keys(options).length > 0),
              })

              if (!shouldRenderOptions || !options) return null

              return (
                <OptionsSelector
                  options={options}
                  onSelect={handleOptionSelect}
                  disabled={!isLastMessage || isSendingMessage || isStreaming}
                  enableKeyboardNav={
                    isLastMessage && !isStreaming && parsedTags?.optionsComplete === true
                  }
                  streaming={isStreaming || parsedTags?.optionsComplete === false}
                />
              )
            })()}
          </div>
        </div>
      )
    }

    return null
  },
  (prevProps, nextProps) => {
    // Custom comparison function for better streaming performance
    const prevMessage = prevProps.message
    const nextMessage = nextProps.message

    // If message IDs are different, always re-render
    if (prevMessage.id !== nextMessage.id) {
      return false
    }

    // If streaming state changed, re-render
    if (prevProps.isStreaming !== nextProps.isStreaming) {
      return false
    }

    // If dimmed state changed, re-render
    if (prevProps.isDimmed !== nextProps.isDimmed) {
      return false
    }

    // If panel width changed, re-render
    if (prevProps.panelWidth !== nextProps.panelWidth) {
      return false
    }

    // For streaming messages, check if content actually changed
    if (nextProps.isStreaming) {
      const prevBlocks = prevMessage.contentBlocks || []
      const nextBlocks = nextMessage.contentBlocks || []

      if (prevBlocks.length !== nextBlocks.length) {
        return false // Content blocks changed
      }

      // Helper: get last block content by type
      const getLastBlockContent = (blocks: any[], type: 'text' | 'thinking'): string | null => {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]
          if (block && block.type === type) {
            return (block as any).content ?? ''
          }
        }
        return null
      }

      // Re-render if the last text block content changed
      const prevLastTextContent = getLastBlockContent(prevBlocks as any[], 'text')
      const nextLastTextContent = getLastBlockContent(nextBlocks as any[], 'text')
      if (
        prevLastTextContent !== null &&
        nextLastTextContent !== null &&
        prevLastTextContent !== nextLastTextContent
      ) {
        return false
      }

      // Re-render if the last thinking block content changed
      const prevLastThinkingContent = getLastBlockContent(prevBlocks as any[], 'thinking')
      const nextLastThinkingContent = getLastBlockContent(nextBlocks as any[], 'thinking')
      if (
        prevLastThinkingContent !== null &&
        nextLastThinkingContent !== null &&
        prevLastThinkingContent !== nextLastThinkingContent
      ) {
        return false
      }

      // Check if tool calls changed
      const prevToolCalls = prevMessage.toolCalls || []
      const nextToolCalls = nextMessage.toolCalls || []

      if (prevToolCalls.length !== nextToolCalls.length) {
        return false // Tool calls count changed
      }

      for (let i = 0; i < nextToolCalls.length; i++) {
        if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
          return false // Tool call state changed
        }
      }

      return true
    }

    // For non-streaming messages, do a deeper comparison including tool call states
    if (
      prevMessage.content !== nextMessage.content ||
      prevMessage.role !== nextMessage.role ||
      (prevMessage.toolCalls?.length || 0) !== (nextMessage.toolCalls?.length || 0) ||
      (prevMessage.contentBlocks?.length || 0) !== (nextMessage.contentBlocks?.length || 0)
    ) {
      return false
    }

    // Check tool call states for non-streaming messages too
    const prevToolCalls = prevMessage.toolCalls || []
    const nextToolCalls = nextMessage.toolCalls || []
    for (let i = 0; i < nextToolCalls.length; i++) {
      if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
        return false // Tool call state changed
      }
    }

    // Check contentBlocks tool call states
    const prevContentBlocks = prevMessage.contentBlocks || []
    const nextContentBlocks = nextMessage.contentBlocks || []
    for (let i = 0; i < nextContentBlocks.length; i++) {
      const prevBlock = prevContentBlocks[i]
      const nextBlock = nextContentBlocks[i]
      if (
        prevBlock?.type === 'tool_call' &&
        nextBlock?.type === 'tool_call' &&
        prevBlock.toolCall?.state !== nextBlock.toolCall?.state
      ) {
        return false // ContentBlock tool call state changed
      }
    }

    return true
  }
)

CopilotMessage.displayName = 'CopilotMessage'

export { CopilotMessage }
