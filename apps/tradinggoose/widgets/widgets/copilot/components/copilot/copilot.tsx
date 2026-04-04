'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore, useCopilotStoreApi } from '@/stores/copilot/store'
import type { ChatContext, CopilotChat } from '@/stores/copilot/types'
import type { ReviewTargetMode } from '@/widgets/hooks/use-workflow-widget-state'
import type { PairColor } from '@/widgets/pair-colors'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { CopilotMessage, CopilotWelcome, TodoList, UserInput } from '..'
import type { MessageFileAttachment, UserInputRef } from '../user-input/user-input'

const logger = createLogger('Copilot')

// Default enabled/disabled state for all models (must match API)
const DEFAULT_ENABLED_MODELS: Record<string, boolean> = {
  'gpt-4o': false,
  'gpt-4.1': false,
  'gpt-5-fast': false,
  'gpt-5': true,
  'gpt-5-medium': true,
  'gpt-5-high': false,
  o3: true,
  'claude-4-sonnet': false,
  'claude-4.5-haiku': true,
  'claude-4.5-sonnet': true,
  'claude-4.1-opus': true,
}

interface CopilotProps {
  panelWidth: number
  initialReviewSessionId?: string | null
  onReviewSessionChange?: (reviewSessionId: string | null) => void
  pairColor?: PairColor
  reviewTargetMode?: ReviewTargetMode
}

interface CopilotRef {
  createNewChat: () => void
  setInputValueAndFocus: (value: string) => void
}

export const Copilot = forwardRef<CopilotRef, CopilotProps>(
  (
    {
      panelWidth,
      initialReviewSessionId = null,
      onReviewSessionChange,
      pairColor: _pairColor = 'gray',
      reviewTargetMode = { kind: 'workflow' },
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const userInputRef = useRef<UserInputRef>(null)
    const [isInitialized, setIsInitialized] = useState(false)
    const [todosCollapsed, setTodosCollapsed] = useState(false)
    const lastTargetKeyRef = useRef<string | null>(null)
    const hasLoadedModelsRef = useRef(false)
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [isEditingMessage, setIsEditingMessage] = useState(false)
    const pendingReviewSessionIdRef = useRef<string | null>(initialReviewSessionId ?? null)
    const lastNotifiedReviewSessionIdRef = useRef<string | null>(initialReviewSessionId ?? null)

    // Scroll state
    const [isNearBottom, setIsNearBottom] = useState(true)
    const [showScrollButton, setShowScrollButton] = useState(false)
    // New state to track if user has intentionally scrolled during streaming
    const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
    const isUserScrollingRef = useRef(false) // Track if scroll event is user-initiated

    const { workflowId: activeWorkflowId } = useWorkflowRoute()
    const isEntityMode = reviewTargetMode.kind === 'entity'
    const entityReviewSessionId =
      reviewTargetMode.kind === 'entity' ? reviewTargetMode.reviewSessionId : null

    // Use the new copilot store
    const {
      messages,
      chats,
      isLoadingChats,
      isSendingMessage,
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
      chatsLoadedForWorkflow,
      setWorkflowId: setCopilotWorkflowId,
      loadChats,
      selectChat,
      enabledModels,
      setEnabledModels,
      selectedModel,
      setSelectedModel,
      currentChat,
      fetchContextUsage,
    } = useCopilotStore()
    const copilotStoreApi = useCopilotStoreApi()

    useEffect(() => {
      pendingReviewSessionIdRef.current = initialReviewSessionId ?? entityReviewSessionId ?? null
    }, [entityReviewSessionId, initialReviewSessionId])

    const loadReviewSession = useCallback(
      async (reviewSessionId: string): Promise<CopilotChat | null> => {
        try {
          const response = await fetch(
            `/api/copilot/chat?reviewSessionId=${encodeURIComponent(reviewSessionId)}`
          )
          if (!response.ok) {
            throw new Error(`Failed to fetch review session: ${response.status}`)
          }

          const data = await response.json()
          if (!data.success || !Array.isArray(data.chats)) {
            return null
          }

          const nextChat: CopilotChat | null =
            data.chats.find((chat: CopilotChat) => chat.reviewSessionId === reviewSessionId) ??
            data.chats[0] ??
            null

          if (!nextChat) {
            return null
          }

          copilotStoreApi.setState({ chats: [nextChat] })
          await selectChat(nextChat)
          return nextChat
        } catch (error) {
          logger.error('Failed to load review session', { reviewSessionId, error })
          return null
        }
      },
      [copilotStoreApi, selectChat]
    )

    // Load user's enabled models on mount
    useEffect(() => {
      const loadEnabledModels = async () => {
        if (hasLoadedModelsRef.current) return
        hasLoadedModelsRef.current = true

        try {
          const res = await fetch('/api/copilot/user-models')
          if (!res.ok) {
            logger.warn('Failed to fetch user models, using defaults')
            // Use defaults if fetch fails
            const enabledArray = Object.keys(DEFAULT_ENABLED_MODELS).filter(
              (key) => DEFAULT_ENABLED_MODELS[key]
            )
            setEnabledModels(enabledArray)
            return
          }

          const data = await res.json()
          const modelsMap = data.enabledModels || DEFAULT_ENABLED_MODELS

          // Convert map to array of enabled model IDs
          const enabledArray = Object.entries(modelsMap)
            .filter(([_, enabled]) => enabled)
            .map(([modelId]) => modelId)

          setEnabledModels(enabledArray)
          logger.info('Loaded user enabled models', { count: enabledArray.length })
        } catch (error) {
          logger.error('Failed to load enabled models', { error })
          // Use defaults on error
          const enabledArray = Object.keys(DEFAULT_ENABLED_MODELS).filter(
            (key) => DEFAULT_ENABLED_MODELS[key]
          )
          setEnabledModels(enabledArray)
        }
      }

      loadEnabledModels()
    }, [setEnabledModels])

    // Ensure selected model is in the enabled models list
    useEffect(() => {
      if (!enabledModels || enabledModels.length === 0) return

      // Check if current selected model is in the enabled list
      if (selectedModel && !enabledModels.includes(selectedModel)) {
        // Switch to the first enabled model (prefer claude-4.5-sonnet if available)
        const preferredModel = 'claude-4.5-sonnet'
        const fallbackModel = enabledModels[0] as typeof selectedModel

        if (enabledModels.includes(preferredModel)) {
          setSelectedModel(preferredModel)
          logger.info('Selected model not enabled, switching to preferred model', {
            from: selectedModel,
            to: preferredModel,
          })
        } else if (fallbackModel) {
          setSelectedModel(fallbackModel)
          logger.info('Selected model not enabled, switching to first available', {
            from: selectedModel,
            to: fallbackModel,
          })
        }
      }
    }, [enabledModels, selectedModel, setSelectedModel])

    useEffect(() => {
      let cancelled = false

      const initialize = async () => {
        const targetKey = isEntityMode
          ? `entity:${entityReviewSessionId ?? 'pending'}`
          : `workflow:${activeWorkflowId ?? 'pending'}`

        if (targetKey === lastTargetKeyRef.current && isInitialized) {
          return
        }

        lastTargetKeyRef.current = targetKey
        setIsInitialized(false)

        if (isEntityMode) {
          await setCopilotWorkflowId(null)
          if (cancelled) return

          if (!entityReviewSessionId) {
            copilotStoreApi.setState({
              currentChat: null,
              chats: [],
              messages: [],
              toolCallsById: {},
              contextUsage: null,
              isLoadingChats: false,
              chatsLoadedForWorkflow: null,
            })
            return
          }

          await loadReviewSession(entityReviewSessionId)
          if (!cancelled) {
            setIsInitialized(true)
          }
          return
        }

        if (!activeWorkflowId) {
          return
        }

        await setCopilotWorkflowId(activeWorkflowId)
        if (cancelled) return

        await loadChats(true)
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
    }, [
      activeWorkflowId,
      copilotStoreApi,
      entityReviewSessionId,
      isEntityMode,
      isInitialized,
      loadChats,
      loadReviewSession,
      setCopilotWorkflowId,
    ])

    useEffect(() => {
      const targetReviewSessionId = pendingReviewSessionIdRef.current
      if (!targetReviewSessionId || !isInitialized) return

      if (currentChat?.reviewSessionId === targetReviewSessionId) {
        pendingReviewSessionIdRef.current = null
        return
      }

      let cancelled = false

      const alignSelectedChat = async () => {
        if (isEntityMode) {
          await loadReviewSession(targetReviewSessionId)
          if (!cancelled) {
            pendingReviewSessionIdRef.current = null
          }
          return
        }

        if (!activeWorkflowId || isLoadingChats || chatsLoadedForWorkflow !== activeWorkflowId) {
          return
        }

        const match = (chats || []).find((chat) => chat.reviewSessionId === targetReviewSessionId)
        if (match) {
          await selectChat(match)
        }

        if (!cancelled) {
          pendingReviewSessionIdRef.current = null
        }
      }

      alignSelectedChat().catch((error) => {
        logger.warn('Failed to align selected review session', {
          reviewSessionId: targetReviewSessionId,
          error,
        })
        pendingReviewSessionIdRef.current = null
      })

      return () => {
        cancelled = true
      }
    }, [
      activeWorkflowId,
      chats,
      chatsLoadedForWorkflow,
      currentChat?.reviewSessionId,
      isEntityMode,
      isInitialized,
      isLoadingChats,
      loadReviewSession,
      selectChat,
    ])

    // Fetch context usage when component is initialized and has a current chat
    useEffect(() => {
      if (isInitialized && currentChat?.reviewSessionId && currentChat.entityKind === 'workflow') {
        logger.info('[Copilot] Component initialized, fetching context usage')
        fetchContextUsage().catch((err) => {
          logger.warn('[Copilot] Failed to fetch context usage on mount', err)
        })
      }
    }, [isInitialized, currentChat?.entityKind, currentChat?.reviewSessionId, fetchContextUsage])

    // Keep widget params in sync with the active chat
    useEffect(() => {
      if (!onReviewSessionChange) return
      if (!isInitialized) return

      const nextId = currentChat?.reviewSessionId ?? null
      if (nextId === lastNotifiedReviewSessionIdRef.current) return

      if (nextId || lastNotifiedReviewSessionIdRef.current !== null) {
        lastNotifiedReviewSessionIdRef.current = nextId
        onReviewSessionChange(nextId)
      }
    }, [currentChat?.reviewSessionId, isInitialized, onReviewSessionChange])

    // Scroll to bottom function
    const scrollToBottom = useCallback(() => {
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector(
          '[data-radix-scroll-area-viewport]'
        )
        if (scrollContainer) {
          // Mark that we're programmatically scrolling
          isUserScrollingRef.current = false
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth',
          })
        }
      }
    }, [])

    // Handle scroll events to track user position
    const handleScroll = useCallback(() => {
      const scrollArea = scrollAreaRef.current
      if (!scrollArea) return

      // Find the viewport element inside the ScrollArea
      const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
      if (!viewport) return

      const { scrollTop, scrollHeight, clientHeight } = viewport
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      // Consider "near bottom" if within 100px of bottom
      const nearBottom = distanceFromBottom <= 100
      setIsNearBottom(nearBottom)
      setShowScrollButton(!nearBottom)

      // If user scrolled up during streaming, mark it
      if (isSendingMessage && !nearBottom && isUserScrollingRef.current) {
        setUserHasScrolledDuringStream(true)
      }

      // Reset the user scrolling flag after processing
      isUserScrollingRef.current = true
    }, [isSendingMessage])

    // Attach scroll listener
    useEffect(() => {
      const scrollArea = scrollAreaRef.current
      if (!scrollArea) return

      // Find the viewport element inside the ScrollArea
      const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
      if (!viewport) return

      // Mark user-initiated scrolls
      const handleUserScroll = () => {
        isUserScrollingRef.current = true
        handleScroll()
      }

      viewport.addEventListener('scroll', handleUserScroll, { passive: true })

      // Also listen for scrollend event if available (for smooth scrolling)
      if ('onscrollend' in viewport) {
        viewport.addEventListener('scrollend', handleScroll, { passive: true })
      }

      // Initial scroll state check with small delay to ensure DOM is ready
      setTimeout(handleScroll, 100)

      return () => {
        viewport.removeEventListener('scroll', handleUserScroll)
        if ('onscrollend' in viewport) {
          viewport.removeEventListener('scrollend', handleScroll)
        }
      }
    }, [handleScroll])

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
        (isSendingMessage && !userHasScrolledDuringStream) ||
        (!isSendingMessage && isNearBottom)

      if (shouldAutoScroll && scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector(
          '[data-radix-scroll-area-viewport]'
        )
        if (scrollContainer) {
          // Mark that we're programmatically scrolling
          isUserScrollingRef.current = false
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth',
          })
        }
      }
    }, [messages, isNearBottom, isSendingMessage, userHasScrolledDuringStream])

    // Reset user scroll state when streaming starts or when user sends a message
    useEffect(() => {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'user') {
        // User sent a new message - reset scroll state
        setUserHasScrolledDuringStream(false)
        isUserScrollingRef.current = false
      }
    }, [messages])

    // Reset user scroll state when streaming completes
    const prevIsSendingRef = useRef(false)
    useEffect(() => {
      // When streaming transitions from true to false, reset the user scroll state
      if (prevIsSendingRef.current && !isSendingMessage) {
        setUserHasScrolledDuringStream(false)
      }
      prevIsSendingRef.current = isSendingMessage
    }, [isSendingMessage])

    // Auto-scroll to bottom when chat loads in
    useEffect(() => {
      if (isInitialized && messages.length > 0) {
        scrollToBottom()
      }
    }, [isInitialized, messages.length, scrollToBottom])

    // Track previous sending state to detect when stream completes
    const wasSendingRef = useRef(false)

    // Auto-collapse todos and remove uncompleted ones when stream completes
    useEffect(() => {
      if (wasSendingRef.current && !isSendingMessage && showPlanTodos) {
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
      wasSendingRef.current = isSendingMessage
    }, [isSendingMessage, showPlanTodos, planTodos])

    // Reset collapsed state when todos first appear
    useEffect(() => {
      if (showPlanTodos && planTodos.length > 0) {
        // Check if this is the first time todos are showing
        // (only expand if currently sending a message, meaning new todos are being created)
        if (isSendingMessage) {
          setTodosCollapsed(false)
        }
      }
    }, [showPlanTodos, planTodos.length, isSendingMessage])

    // Cleanup on component unmount (page refresh, navigation, etc.)
    useEffect(() => {
      return () => {
        // Abort any active message streaming and terminate active tools
        if (isSendingMessage) {
          abortMessage()
          logger.info('Aborted active message streaming due to component unmount')
        }
      }
    }, [isSendingMessage, abortMessage])

    // Handle new chat creation
    const handleStartNewChat = useCallback(() => {
      if (isEntityMode) {
        return
      }

      createNewChat()
      logger.info('Started new chat')

      // Focus the input after creating new chat
      setTimeout(() => {
        userInputRef.current?.focus()
      }, 100) // Small delay to ensure DOM updates are complete
    }, [createNewChat, isEntityMode])

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
        if (!query || isSendingMessage) return
        if (!isEntityMode && !activeWorkflowId) return
        if (isEntityMode && !currentChat?.reviewSessionId) return

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
      [activeWorkflowId, currentChat?.reviewSessionId, isEntityMode, isSendingMessage, sendMessage, showPlanTodos]
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
                <p className='text-muted-foreground text-sm'>
                  {isEntityMode ? 'Loading review session...' : 'Loading chat history...'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Messages area */}
              <div className='relative flex-1 overflow-hidden'>
                <ScrollArea ref={scrollAreaRef} className='h-full' hideScrollbar={true}>
                  <div className='w-full max-w-full space-y-2 overflow-hidden'>
                    {messages.length === 0 && !isSendingMessage && !isEditingMessage ? (
                      <div className='flex h-full items-center justify-center p-4'>
                        <CopilotWelcome
                          onQuestionClick={handleSubmit}
                          accessLevel={accessLevel}
                        />
                      </div>
                    ) : (
                      messages.map((message, index) => {
                        // Determine if this message should be dimmed
                        let isDimmed = false

                        // Dim messages after the one being edited
                        if (editingMessageId) {
                          const editingIndex = messages.findIndex(
                            (m) => m.id === editingMessageId
                          )
                          isDimmed = editingIndex !== -1 && index > editingIndex
                        }

                        return (
                          <CopilotMessage
                            key={message.id}
                            message={message}
                            isStreaming={
                              isSendingMessage && message.id === messages[messages.length - 1]?.id
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
                      onClick={scrollToBottom}
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
              {showPlanTodos && (
                <TodoList
                  todos={planTodos}
                  collapsed={todosCollapsed}
                  onClose={() => {
                    const store = copilotStoreApi.getState()
                    store.setPlanTodos([])
                  }}
                />
              )}

              {/* Input area with integrated access selector */}
              <div className='pt-2'>
                <UserInput
                  ref={userInputRef}
                  onSubmit={handleSubmit}
                  onAbort={handleAbort}
                  disabled={isEntityMode ? !currentChat?.reviewSessionId : !activeWorkflowId}
                  isLoading={isSendingMessage}
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
