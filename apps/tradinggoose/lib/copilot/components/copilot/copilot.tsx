'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ChatContext } from '@/lib/copilot/chat-context-schema'
import type { ImagePart } from '@/lib/copilot/native/contract'
import { createLogger } from '@/lib/logs/console/logger'
import { reasoningSelectionError } from '@/lib/mastra/reasoning'
import { normalizeOptionalString } from '@/lib/utils'
import { useCopilotModels } from '@/hooks/queries/copilot-models'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore } from '@/stores/copilot/store'
import { buildPlanTodosFromMessages } from '@/stores/copilot/store-messages'
import { isCopilotBusy } from '@/stores/copilot/store-state'
import type { CopilotSendRuntimeContext } from '@/stores/copilot/types'
import { CopilotMessage } from '../copilot-message/copilot-message'
import { TodoList } from '../todo-list/todo-list'
import { UserInput } from '../user-input/user-input'
import { CopilotWelcome } from '../welcome/welcome'

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
  currentContext: ChatContext | null
}

export function Copilot({ workspaceId, panelWidth, currentContext }: CopilotProps) {
  const copilotCopy = useCopilotMessages()
  const retry = useTranslations('workspace.widgets.stateMessage')('retry')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prependScroll = useRef<{ threadId?: string; height: number; first?: string } | null>(null)
  const visibleThread = useRef<string | undefined>(undefined)
  const [isInitialized, setIsInitialized] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  // Scroll state
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
  const programmaticScrollResetTimerRef = useRef<number | null>(null)
  const programmaticScrollInFlightRef = useRef(false)

  const implicitContexts = useMemo(() => (currentContext ? [currentContext] : []), [currentContext])
  const sendRuntimeContext = useMemo<CopilotSendRuntimeContext>(
    () => ({
      workspaceId: normalizeOptionalString(workspaceId) ?? null,
      implicitContexts,
    }),
    [implicitContexts, workspaceId]
  )
  const state = useCopilotStore()
  const {
    isAborting,
    selectedModel,
    reasoning,
    accessLevel,
    draft,
    sendMessage,
    abortMessage,
    setDraft,
    loadChats,
    error,
  } = state
  const conversationInScope = state.conversationWorkspaceId === workspaceId
  const messages = conversationInScope ? state.messages : []
  const historyError =
    (conversationInScope && state.historyError) ||
    (state.chatsWorkspaceId === workspaceId && state.chatsError)
  const { data } = useCopilotModels()
  const model = data?.models.find(({ id }) => id === selectedModel)
  const submitDisabled =
    !model ||
    (!reasoning && !!model.reasoningOptions?.length) ||
    !!reasoningSelectionError(model.id, model.reasoningOptions, reasoning?.value)
  const isTurnInProgress = isCopilotBusy(state)
  const planTodos = useMemo(
    () => (isTurnInProgress ? buildPlanTodosFromMessages(messages) : []),
    [isTurnInProgress, messages]
  )
  const showingMessages = conversationInScope && (isInitialized || messages.length > 0)
  const lastMessage = messages.at(-1)
  const lastUserId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === 'user') return messages[index].id
    }
  }, [messages])
  const editingIndex = editingMessageId
    ? messages.findIndex((item) => item.id === editingMessageId)
    : -1
  const threadId = state.currentChat?.threadId

  useLayoutEffect(() => {
    const before = prependScroll.current
    if (!before || state.loadingEarlier) return
    prependScroll.current = null
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]')
    if (viewport && before.threadId === threadId && before.first !== messages[0]?.id)
      viewport.scrollTop += viewport.scrollHeight - before.height
  }, [messages, state.loadingEarlier, threadId])

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      setIsInitialized(false)
      await loadChats({ workspaceId })
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
  }, [loadChats, workspaceId])

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
          '[data-slot="scroll-area-viewport"]'
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

      const viewport = scrollArea.querySelector('[data-slot="scroll-area-viewport"]')
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
    if (!showingMessages || !scrollArea) return

    const viewport = scrollArea.querySelector('[data-slot="scroll-area-viewport"]')
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
  }, [clearProgrammaticScrollLock, handleScroll, showingMessages])

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current
    if (!showingMessages || !messagesContainer || typeof ResizeObserver === 'undefined') return

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
  }, [isNearBottom, isTurnInProgress, scrollToBottom, showingMessages, userHasScrolledDuringStream])

  // Smart auto-scroll: only scroll if user hasn't intentionally scrolled up during streaming
  useEffect(() => {
    if (!lastMessage) return
    const opening = visibleThread.current !== threadId
    visibleThread.current = threadId
    const isNewUserMessage = lastMessage?.role === 'user'

    // Conditions for auto-scrolling:
    // 1. Always scroll for new user messages (resets the user scroll state)
    // 2. For assistant messages during streaming: only if user hasn't scrolled up
    // 3. For assistant messages when not streaming: only if near bottom
    const shouldAutoScroll =
      opening ||
      isNewUserMessage ||
      (isTurnInProgress && !userHasScrolledDuringStream) ||
      (!isTurnInProgress && isNearBottom)

    if (shouldAutoScroll) {
      scrollToBottom(opening || (isTurnInProgress && !isNewUserMessage) ? 'auto' : 'smooth')
    }
  }, [
    isNearBottom,
    isTurnInProgress,
    lastMessage,
    threadId,
    scrollToBottom,
    userHasScrolledDuringStream,
  ])

  // Reset user scroll state when streaming starts or when user sends a message
  useEffect(() => {
    if (lastMessage?.role === 'user') {
      setUserHasScrolledDuringStream(false)
      clearProgrammaticScrollLock()
    }
  }, [clearProgrammaticScrollLock, lastMessage])

  // Reset user scroll state when streaming completes
  const prevIsTurnInProgressRef = useRef(false)
  useEffect(() => {
    // When streaming transitions from true to false, reset the user scroll state
    if (prevIsTurnInProgressRef.current && !isTurnInProgress) {
      setUserHasScrolledDuringStream(false)
    }
    prevIsTurnInProgressRef.current = isTurnInProgress
  }, [isTurnInProgress])

  // Handle message submission
  const handleSubmit = useCallback(
    async (
      query: string,
      images?: ImagePart[],
      contexts?: ChatContext[],
      onAccepted?: () => void
    ) => {
      if (!query || isTurnInProgress || submitDisabled) return false

      try {
        const completed = await sendMessage(query, {
          images,
          contexts,
          onAccepted,
          runtimeContext: sendRuntimeContext,
        })
        if (!completed) return false
        logger.info('Sent message:', query, images ? `with ${images.length} attachments` : '')
        return true
      } catch (error) {
        logger.error('Failed to send message:', error)
        return false
      }
    },
    [isTurnInProgress, sendMessage, sendRuntimeContext, submitDisabled]
  )

  const handleEditModeChange = useCallback((messageId: string, isEditing: boolean) => {
    setEditingMessageId(isEditing ? messageId : null)
    logger.info('Edit mode changed', { messageId, isEditing, willDimMessages: isEditing })
  }, [])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      {historyError && (
        <div role='alert' className='px-3 py-2 text-destructive text-sm'>
          {copilotCopy.history.loadError} {historyError}
          <Button
            type='button'
            size='sm'
            variant='link'
            disabled={state.isLoadingChats}
            onClick={() => void loadChats({ workspaceId })}
          >
            {retry}
          </Button>
        </div>
      )}
      {!showingMessages ? (
        !historyError && (
          <div className='flex h-full w-full items-center justify-center'>
            <div className='flex flex-col items-center justify-center gap-3'>
              <LoadingAgent size='md' />
              <p className='text-muted-foreground text-sm'>
                {copilotCopy.history.loadingChatHistory}
              </p>
            </div>
          </div>
        )
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
                {state.historyPage?.hasMore && (
                  <Button
                    type='button'
                    variant='link'
                    size='sm'
                    disabled={state.loadingEarlier}
                    onClick={() => {
                      const viewport = scrollAreaRef.current?.querySelector(
                        '[data-slot="scroll-area-viewport"]'
                      )
                      if (viewport)
                        prependScroll.current = {
                          threadId,
                          height: viewport.scrollHeight,
                          first: messages[0]?.id,
                        }
                      void state.loadEarlierMessages()
                    }}
                  >
                    {copilotCopy.history.showEarlier}
                  </Button>
                )}
                {state.earlierError && <p role='alert'>{state.earlierError}</p>}
                {messages.length === 0 &&
                !historyError &&
                !state.isLoadingChats &&
                !isTurnInProgress &&
                !editingMessageId ? (
                  <div className='flex h-full items-center justify-center p-4'>
                    <CopilotWelcome
                      onQuestionClick={handleSubmit}
                      accessLevel={accessLevel}
                      disabled={submitDisabled}
                    />
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <CopilotMessage
                      key={message.id}
                      message={message}
                      runtimeContext={sendRuntimeContext}
                      submitDisabled={submitDisabled}
                      isLastMessage={message === lastMessage}
                      isLastUserMessage={message.id === lastUserId}
                      isTurnInProgress={isTurnInProgress}
                      panelWidth={panelWidth}
                      isDimmed={editingIndex !== -1 && index > editingIndex}
                      onEditModeChange={handleEditModeChange}
                    />
                  ))
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
                  className='flex h-7 w-7 items-center gap-1 rounded-lg border border-border bg-background shadow-lg transition-all hover:bg-muted'
                >
                  <ArrowDown className='h-3.5 w-3.5 font-bold text-gray-700 dark:text-gray-300' />
                  <span className='sr-only'>{copilotCopy.message.scrollToBottom}</span>
                </Button>
              </div>
            )}
          </div>

          {/* Todo list from plan tool */}
          {isTurnInProgress && planTodos.some((todo) => !todo.completed) && (
            <TodoList todos={planTodos} />
          )}

          {/* Input area with integrated access selector */}
          <div className='pt-2'>
            {error && (
              <p role='alert' className='px-3 pb-2 text-destructive text-sm'>
                {error}
              </p>
            )}
            <UserInput
              workspaceId={workspaceId}
              onSubmit={handleSubmit}
              onAbort={abortMessage}
              isLoading={isTurnInProgress}
              submitDisabled={submitDisabled}
              isAborting={isAborting}
              draft={draft}
              onDraftChange={setDraft}
              panelWidth={panelWidth}
            />
          </div>
        </>
      )}
    </div>
  )
}
