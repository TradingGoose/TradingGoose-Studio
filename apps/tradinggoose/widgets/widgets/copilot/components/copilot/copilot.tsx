'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ScrollArea } from '@/components/ui/scroll-area'
import { areCopilotContextsEqual } from '@/lib/copilot/chat-contexts'
import { DEFAULT_COPILOT_RUNTIME_MODEL } from '@/lib/copilot/runtime-models'
import { createLogger } from '@/lib/logs/console/logger'
import { normalizeOptionalString } from '@/lib/utils'
import { useCopilotStore, useCopilotStoreApi } from '@/stores/copilot/store'
import { hasUiActiveToolCalls } from '@/stores/copilot/store-state'
import type { ChatContext } from '@/stores/copilot/types'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import {
  buildCopilotEditableReviewTargets,
  buildImplicitCopilotContexts,
  resolveCopilotWorkflowId,
} from '@/widgets/widgets/copilot/live-contexts'
import { CopilotMessage, CopilotWelcome, TodoList, UserInput } from '..'
import type { MessageFileAttachment, UserInputRef } from '../user-input/user-input'

const logger = createLogger('Copilot')
const COPILOT_MESSAGE_VIEWPORT_CLASSNAME = '[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full'
const AUTO_SCROLL_LOCK_MS = 120
const SMOOTH_SCROLL_LOCK_MS = 450

export function shouldMarkUserScrolledDuringStream(params: {
  isTurnInProgress: boolean
  nearBottom: boolean
  scrollSource: 'user' | 'programmatic'
}) {
  return params.isTurnInProgress && !params.nearBottom && params.scrollSource === 'user'
}

interface CopilotProps {
  workspaceId: string
  panelWidth: number
  channelId: string
  pairColor?: PairColor
  inputDisabled?: boolean
}

interface CopilotRef {
  createNewChat: () => void
  setInputValueAndFocus: (value: string) => void
}

export const Copilot = forwardRef<CopilotRef, CopilotProps>(
  ({ workspaceId, panelWidth, channelId, pairColor = 'gray', inputDisabled = false }, ref) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const userInputRef = useRef<UserInputRef>(null)
    const [isInitialized, setIsInitialized] = useState(false)
    const [todosCollapsed, setTodosCollapsed] = useState(false)
    const lastScopeKeyRef = useRef<string | null>(null)
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [isEditingMessage, setIsEditingMessage] = useState(false)

    // Scroll state
    const [isNearBottom, setIsNearBottom] = useState(true)
    const [showScrollButton, setShowScrollButton] = useState(false)
    const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
    const programmaticScrollResetTimerRef = useRef<number | null>(null)
    const programmaticScrollInFlightRef = useRef(false)

    const pairContext = usePairColorContext(pairColor)
    const implicitContexts = useMemo(
      () =>
        buildImplicitCopilotContexts({
          workspaceId,
          pairContext,
        }),
      [pairContext, workspaceId]
    )
    const workflowId = resolveCopilotWorkflowId(pairContext) ?? null
    const reviewTarget = useMemo(
      () => buildCopilotEditableReviewTargets({ pairContext })[0] ?? null,
      [pairContext]
    )
    const liveContext = useMemo(
      () => ({
        workflowId,
        workspaceId: normalizeOptionalString(workspaceId) ?? null,
        reviewTarget: reviewTarget
          ? {
              entityKind: reviewTarget.entityKind,
              entityId: reviewTarget.entityId,
              reviewSessionId: reviewTarget.reviewSessionId ?? null,
              draftSessionId: reviewTarget.draftSessionId,
            }
          : null,
      }),
      [reviewTarget, workflowId, workspaceId]
    )
    // Use the new copilot store
    const {
      messages,
      chats,
      isLoadingChats,
      isSendingMessage,
      isAwaitingContinuation,
      abortController,
      isAborting,
      accessLevel,
      inputValue,
      planTodos,
      showPlanTodos,
      sendMessage,
      abortMessage,
      createNewChat,
      setAccessLevel,
      setInputValue,
      loadChats,
      selectedModel,
      setSelectedModel,
      currentChat,
      toolCallsById,
      fetchContextUsage,
    } = useCopilotStore()
    const copilotStoreApi = useCopilotStoreApi()
    const hasActiveToolCalls = useMemo(() => hasUiActiveToolCalls(toolCallsById), [toolCallsById])
    const isTurnInProgress =
      isSendingMessage ||
      isAwaitingContinuation ||
      currentChat?.latestTurnStatus === 'in_progress' ||
      hasActiveToolCalls

    useLayoutEffect(() => {
      const storeState = copilotStoreApi.getState()
      const nextState: Record<string, unknown> = {}

      if (!areCopilotContextsEqual(storeState.implicitContexts, implicitContexts)) {
        nextState.implicitContexts = implicitContexts
      }

      const currentLiveContext = storeState.liveContext
      if (
        currentLiveContext.workflowId !== liveContext.workflowId ||
        currentLiveContext.workspaceId !== liveContext.workspaceId ||
        currentLiveContext.reviewTarget?.entityKind !== liveContext.reviewTarget?.entityKind ||
        currentLiveContext.reviewTarget?.entityId !== liveContext.reviewTarget?.entityId ||
        currentLiveContext.reviewTarget?.reviewSessionId !==
          liveContext.reviewTarget?.reviewSessionId ||
        currentLiveContext.reviewTarget?.draftSessionId !== liveContext.reviewTarget?.draftSessionId
      ) {
        nextState.liveContext = liveContext
      }

      if (Object.keys(nextState).length > 0) {
        copilotStoreApi.setState(nextState as any)
      }
    }, [copilotStoreApi, implicitContexts, liveContext])

    useEffect(() => {
      if (!selectedModel) {
        setSelectedModel(DEFAULT_COPILOT_RUNTIME_MODEL)
      }
    }, [selectedModel, setSelectedModel])

    useEffect(() => {
      let cancelled = false

      const initialize = async () => {
        const scopeKey = `workspace:${workspaceId ?? 'pending'}`

        if (scopeKey === lastScopeKeyRef.current && isInitialized) {
          return
        }

        lastScopeKeyRef.current = scopeKey
        setIsInitialized(false)

        await loadChats(true, { workspaceId: workspaceId ?? null })
        if (!cancelled) {
          setIsInitialized(true)
        }
      }

      initialize().catch((error) => {
        if (!cancelled) {
          logger.error('Failed to initialize copilot target', { error })
          setIsInitialized(true)
        }
      })

      return () => {
        cancelled = true
      }
    }, [isInitialized, loadChats, workspaceId])

    // Fetch context usage when component is initialized and has a current chat
    useEffect(() => {
      if (isInitialized && currentChat?.reviewSessionId) {
        logger.info('[Copilot] Component initialized, fetching context usage')
        fetchContextUsage().catch((err) => {
          logger.warn('[Copilot] Failed to fetch context usage on mount', err)
        })
      }
    }, [isInitialized, currentChat?.reviewSessionId, fetchContextUsage])

    const clearProgrammaticScrollLock = useCallback(() => {
      if (programmaticScrollResetTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollResetTimerRef.current)
        programmaticScrollResetTimerRef.current = null
      }
      programmaticScrollInFlightRef.current = false
    }, [])

    const markProgrammaticScroll = useCallback((behavior: ScrollBehavior) => {
      const lockMs = behavior === 'smooth' ? SMOOTH_SCROLL_LOCK_MS : AUTO_SCROLL_LOCK_MS
      if (programmaticScrollResetTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollResetTimerRef.current)
      }
      programmaticScrollInFlightRef.current = true
      programmaticScrollResetTimerRef.current = window.setTimeout(() => {
        programmaticScrollResetTimerRef.current = null
        programmaticScrollInFlightRef.current = false
      }, lockMs)
    }, [])

    const scrollToBottom = useCallback(
      (behavior: ScrollBehavior = 'smooth') => {
        if (scrollAreaRef.current) {
          const scrollContainer = scrollAreaRef.current.querySelector(
            '[data-radix-scroll-area-viewport]'
          )
          if (scrollContainer) {
            markProgrammaticScroll(behavior)
            scrollContainer.scrollTo({
              top: scrollContainer.scrollHeight,
              behavior,
            })
          }
        }
      },
      [markProgrammaticScroll]
    )

    const handleScroll = useCallback(
      (scrollSource: 'user' | 'programmatic' = 'user') => {
        const scrollArea = scrollAreaRef.current
        if (!scrollArea) return

        const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
        if (!viewport) return

        const { scrollTop, scrollHeight, clientHeight } = viewport
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight

        const nearBottom = distanceFromBottom <= 100
        setIsNearBottom(nearBottom)
        setShowScrollButton(!nearBottom)

        if (nearBottom) {
          clearProgrammaticScrollLock()
        }

        if (
          shouldMarkUserScrolledDuringStream({
            isTurnInProgress,
            nearBottom,
            scrollSource,
          })
        ) {
          setUserHasScrolledDuringStream(true)
        }
      },
      [clearProgrammaticScrollLock, isTurnInProgress]
    )

    useEffect(() => {
      return () => {
        clearProgrammaticScrollLock()
      }
    }, [clearProgrammaticScrollLock])

    useEffect(() => {
      const scrollArea = scrollAreaRef.current
      if (!scrollArea) return

      const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
      if (!viewport) return

      const resolveScrollSource = () =>
        programmaticScrollInFlightRef.current ? 'programmatic' : 'user'

      const handleViewportScroll = () => {
        handleScroll(resolveScrollSource())
      }

      const handleViewportScrollEnd = () => {
        handleScroll(resolveScrollSource())
        clearProgrammaticScrollLock()
      }

      viewport.addEventListener('scroll', handleViewportScroll, { passive: true })

      if ('onscrollend' in viewport) {
        viewport.addEventListener('scrollend', handleViewportScrollEnd, { passive: true })
      }

      const timeoutId = window.setTimeout(() => {
        handleScroll(resolveScrollSource())
      }, 100)

      return () => {
        window.clearTimeout(timeoutId)
        viewport.removeEventListener('scroll', handleViewportScroll)
        if ('onscrollend' in viewport) {
          viewport.removeEventListener('scrollend', handleViewportScrollEnd)
        }
      }
    }, [clearProgrammaticScrollLock, handleScroll])

    useEffect(() => {
      const messagesContainer = messagesContainerRef.current
      if (!messagesContainer || typeof ResizeObserver === 'undefined') return

      const observer = new ResizeObserver(() => {
        const shouldAutoScroll =
          (isTurnInProgress && !userHasScrolledDuringStream) || (!isTurnInProgress && isNearBottom)

        if (!shouldAutoScroll) {
          return
        }

        requestAnimationFrame(() => {
          scrollToBottom('auto')
        })
      })

      observer.observe(messagesContainer)

      return () => {
        observer.disconnect()
      }
    }, [isNearBottom, isTurnInProgress, scrollToBottom, userHasScrolledDuringStream])

    // Smart auto-scroll: only scroll if user hasn't intentionally scrolled up during streaming
    useEffect(() => {
      if (messages.length === 0) return

      const lastMessage = messages[messages.length - 1]
      const isNewUserMessage = lastMessage?.role === 'user'

      // Conditions for auto-scrolling:
      // 1. Always scroll for new user messages (resets the user scroll state)
      // 2. For assistant messages during streaming: only if user hasn't scrolled up
      // 3. For assistant messages when not streaming: only if near bottom
      const shouldAutoScroll =
        isNewUserMessage ||
        (isTurnInProgress && !userHasScrolledDuringStream) ||
        (!isTurnInProgress && isNearBottom)

      if (shouldAutoScroll) {
        scrollToBottom(isTurnInProgress && !isNewUserMessage ? 'auto' : 'smooth')
      }
    }, [isNearBottom, isTurnInProgress, messages, scrollToBottom, userHasScrolledDuringStream])

    // Reset user scroll state when streaming starts or when user sends a message
    useEffect(() => {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'user') {
        setUserHasScrolledDuringStream(false)
        clearProgrammaticScrollLock()
      }
    }, [clearProgrammaticScrollLock, messages])

    // Reset user scroll state when streaming completes
    const prevIsTurnInProgressRef = useRef(false)
    useEffect(() => {
      // When streaming transitions from true to false, reset the user scroll state
      if (prevIsTurnInProgressRef.current && !isTurnInProgress) {
        setUserHasScrolledDuringStream(false)
      }
      prevIsTurnInProgressRef.current = isTurnInProgress
    }, [isTurnInProgress])

    // Auto-scroll to bottom when chat loads in
    useEffect(() => {
      if (isInitialized && messages.length > 0) {
        scrollToBottom()
      }
    }, [isInitialized, messages.length, scrollToBottom])

    // Track previous sending state to detect when stream completes
    const wasTurnInProgressRef = useRef(false)

    // Auto-collapse todos and remove uncompleted ones when stream completes
    useEffect(() => {
      if (wasTurnInProgressRef.current && !isTurnInProgress && showPlanTodos) {
        // Stream just completed, collapse the todos and filter out uncompleted ones
        setTodosCollapsed(true)

        // Remove any uncompleted todos
        const completedTodos = planTodos.filter((todo) => todo.completed === true)
        if (completedTodos.length !== planTodos.length) {
          // Only update if there are uncompleted todos to remove
          const store = copilotStoreApi.getState()
          store.setPlanTodos(completedTodos)
        }
      }
      wasTurnInProgressRef.current = isTurnInProgress
    }, [isTurnInProgress, showPlanTodos, planTodos])

    // Reset collapsed state when todos first appear
    useEffect(() => {
      if (showPlanTodos && planTodos.length > 0) {
        // Check if this is the first time todos are showing
        // (only expand if currently sending a message, meaning new todos are being created)
        if (isTurnInProgress) {
          setTodosCollapsed(false)
        }
      }
    }, [showPlanTodos, planTodos.length, isTurnInProgress])

    // Only abort during unmount when there is a live request to cancel.
    // Reloaded/resumable turns intentionally restore isSendingMessage without
    // an abortController, and those should remain resumable across unloads.
    useEffect(() => {
      return () => {
        if (isSendingMessage && abortController) {
          abortMessage()
          logger.info('Aborted active message streaming due to component unmount')
        }
      }
    }, [isSendingMessage, abortController, abortMessage])

    // Handle new chat creation
    const handleStartNewChat = useCallback(() => {
      createNewChat()
      logger.info('Started new chat')

      // Focus the input after creating new chat
      setTimeout(() => {
        userInputRef.current?.focus()
      }, 100) // Small delay to ensure DOM updates are complete
    }, [createNewChat])

    const handleSetInputValueAndFocus = useCallback(
      (value: string) => {
        setInputValue(value)
        setTimeout(() => {
          userInputRef.current?.focus()
        }, 150)
      },
      [setInputValue]
    )

    // Expose functions to parent
    useImperativeHandle(
      ref,
      () => ({
        createNewChat: handleStartNewChat,
        setInputValueAndFocus: handleSetInputValueAndFocus,
      }),
      [handleStartNewChat, handleSetInputValueAndFocus]
    )

    // Handle abort action
    const handleAbort = useCallback(() => {
      abortMessage()
      // Collapse todos when aborting
      if (showPlanTodos) {
        setTodosCollapsed(true)
      }
    }, [abortMessage, showPlanTodos])

    // Handle message submission
    const handleSubmit = useCallback(
      async (
        query: string,
        fileAttachments?: MessageFileAttachment[],
        contexts?: ChatContext[]
      ) => {
        if (!query || isTurnInProgress) return

        // Clear todos when sending a new message
        if (showPlanTodos) {
          const store = copilotStoreApi.getState()
          store.setPlanTodos([])
        }

        try {
          await sendMessage(query, {
            stream: true,
            fileAttachments,
            contexts,
          })
          logger.info(
            'Sent message:',
            query,
            fileAttachments ? `with ${fileAttachments.length} attachments` : ''
          )
        } catch (error) {
          logger.error('Failed to send message:', error)
        }
      },
      [isTurnInProgress, sendMessage, showPlanTodos, copilotStoreApi]
    )

    const handleEditModeChange = useCallback((messageId: string, isEditing: boolean) => {
      setEditingMessageId(isEditing ? messageId : null)
      setIsEditingMessage(isEditing)
      logger.info('Edit mode changed', { messageId, isEditing, willDimMessages: isEditing })
    }, [])

    return (
      <>
        <div className='flex h-full flex-col overflow-hidden'>
          {/* Show loading state until fully initialized */}
          {!isInitialized ? (
            <div className='flex h-full w-full items-center justify-center'>
              <div className='flex flex-col items-center gap-3'>
                <LoadingAgent size='md' />
                <p className='text-muted-foreground text-sm'>Loading chat history...</p>
              </div>
            </div>
          ) : (
            <>
              {/* Messages area */}
              <div className='relative flex-1 overflow-hidden'>
                <ScrollArea
                  ref={scrollAreaRef}
                  className='h-full'
                  viewportClassName={COPILOT_MESSAGE_VIEWPORT_CLASSNAME}
                  hideScrollbar={true}
                >
                  <div
                    ref={messagesContainerRef}
                    className='w-full min-w-0 max-w-full space-y-2 overflow-hidden'
                  >
                    {messages.length === 0 && !isTurnInProgress && !isEditingMessage ? (
                      <div className='flex h-full items-center justify-center p-4'>
                        <CopilotWelcome onQuestionClick={handleSubmit} accessLevel={accessLevel} />
                      </div>
                    ) : (
                      messages.map((message, index) => {
                        // Determine if this message should be dimmed
                        let isDimmed = false

                        // Dim messages after the one being edited
                        if (editingMessageId) {
                          const editingIndex = messages.findIndex((m) => m.id === editingMessageId)
                          isDimmed = editingIndex !== -1 && index > editingIndex
                        }

                        return (
                          <CopilotMessage
                            key={message.id}
                            message={message}
                            isStreaming={
                              (isSendingMessage || isAwaitingContinuation) &&
                              message.id === messages[messages.length - 1]?.id
                            }
                            panelWidth={panelWidth}
                            isDimmed={isDimmed}
                            onEditModeChange={(isEditing) =>
                              handleEditModeChange(message.id, isEditing)
                            }
                          />
                        )
                      })
                    )}
                  </div>
                </ScrollArea>

                {/* Scroll to bottom button */}
                {showScrollButton && (
                  <div className='-translate-x-1/2 absolute bottom-4 left-1/2 z-10'>
                    <Button
                      onClick={() => scrollToBottom()}
                      size='sm'
                      variant='outline'
                      className='flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 shadow-lg transition-all hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700'
                    >
                      <ArrowDown className='h-3.5 w-3.5 text-gray-700 dark:text-gray-300' />
                      <span className='sr-only'>Scroll to bottom</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Todo list from plan tool */}
              {showPlanTodos && <TodoList todos={planTodos} collapsed={todosCollapsed} />}

              {/* Input area with integrated access selector */}
              <div className='pt-2'>
                <UserInput
                  ref={userInputRef}
                  workspaceId={workspaceId}
                  channelId={channelId}
                  onSubmit={handleSubmit}
                  onAbort={handleAbort}
                  disabled={inputDisabled}
                  isLoading={isTurnInProgress}
                  isAborting={isAborting}
                  accessLevel={accessLevel}
                  onAccessLevelChange={setAccessLevel}
                  value={inputValue}
                  onChange={setInputValue}
                  panelWidth={panelWidth}
                />
              </div>
            </>
          )}
        </div>
      </>
    )
  }
)

Copilot.displayName = 'Copilot'
