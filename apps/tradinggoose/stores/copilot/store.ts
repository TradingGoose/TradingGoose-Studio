'use client'

import { createContext, createElement, type ReactNode, useContext, useMemo } from 'react'
import type { StoreApi } from 'zustand'
import { create, useStore } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  shouldAutoExecuteCopilotTool,
  shouldAutoExecuteIntegrationTool,
} from '@/lib/copilot/access-policy'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import { mergeCopilotContexts } from '@/lib/copilot/chat-contexts'
import { DEFAULT_COPILOT_RUNTIME_MODEL } from '@/lib/copilot/runtime-models'
import { resolveCopilotRuntimeProvider } from '@/lib/copilot/runtime-provider'
import { COPILOT_SESSION_KIND } from '@/lib/copilot/session-scope'
import {
  ClientToolCallState,
  REJECTED_TOOL_COMPLETION_STATUS,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolStateSync } from '@/lib/copilot/tools/client/manager'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { createLogger } from '@/lib/logs/console/logger'
import {
  maybeHandleCopilotMarkCompleteContinuation,
  registerCopilotMarkCompleteContinuationHandler,
} from '@/stores/copilot/mark-complete'
import {
  getCopilotStoreForToolCall,
  registerCopilotStoreForToolCallResolver,
} from '@/stores/copilot/store-access'
import {
  getCopilotWorkspaceSelection,
  rememberCopilotWorkspaceSelection,
} from '@/stores/copilot/workspace-selection'
import {
  buildPinnedToolCallsById,
  createErrorMessage,
  createStreamingMessage,
  createUserMessage,
  normalizeMessagesForUI,
  updateMessagesForToolCallState,
  validateMessagesForLLM,
} from '@/stores/copilot/store-messages'
import {
  buildTurnProvenanceFromContexts,
  findAssistantMessageIdForToolCall,
} from '@/stores/copilot/store-provenance'
import {
  ACTIVE_TURN_STATUS,
  buildChatTurnStatusState,
  COMPLETED_TURN_STATUS,
  hasUiActiveToolCalls,
  isChatTurnInProgress,
  resolveStoreTurnActivityState,
  resolveStreamPausedTurnStatus,
  resolveTurnStatusFromToolCalls,
} from '@/stores/copilot/store-state'
import {
  createSSEHandlers,
  flushPendingAutoExecutionToolCalls,
  getStreamingAssistantContent,
  hydrateStreamingBlockIndexes,
  parseSSEStream,
  resetStreamingQueue,
  type StreamingContext,
} from '@/stores/copilot/streaming'
import { reportClientManagedToolFailure } from '@/stores/copilot/tool-failure'
import {
  bindClientToolExecutionContext,
  copilotToolHasInterrupt,
  copilotToolSupportsState,
  createExecutionContext,
  ensureClientToolInstance,
  isBackgroundState,
  isCopilotTool,
  isRejectedState,
  isReviewState,
  isServerManagedCopilotTool,
  prepareCopilotToolArgs,
  resolveToolDisplay,
} from '@/stores/copilot/tool-registry'
import type {
  ChatContext,
  CopilotMessage,
  CopilotSendRuntimeContext,
  CopilotStore,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
  MessageFileAttachment,
} from '@/stores/copilot/types'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

const logger = createLogger('CopilotStore')

const pendingChatPersistence = new Map<string, ReturnType<typeof setTimeout>>()

function clearPendingChatPersistence(reviewSessionId: string) {
  const existing = pendingChatPersistence.get(reviewSessionId)
  if (!existing) {
    return
  }

  clearTimeout(existing)
  pendingChatPersistence.delete(reviewSessionId)
}

function schedulePersistCurrentChatState(
  get: () => CopilotStore,
  reviewSessionId: string,
  latestTurnStatus: string
) {
  clearPendingChatPersistence(reviewSessionId)

  pendingChatPersistence.set(
    reviewSessionId,
    setTimeout(() => {
      pendingChatPersistence.delete(reviewSessionId)
      void get().saveChatMessages(reviewSessionId, { latestTurnStatus })
    }, 48)
  )
}

async function postCopilotMarkComplete(params: {
  toolCallId: string
  toolName: string
  status: number
  message?: unknown
  data?: unknown
}): Promise<Response> {
  const response = await fetch('/api/copilot/tools/mark-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: params.toolCallId,
      name: params.toolName,
      status: params.status,
      message: params.message,
      data: params.data,
    }),
  })

  let continued = false
  if (response.ok) {
    continued = await maybeHandleCopilotMarkCompleteContinuation({
      toolCallId: params.toolCallId,
      response,
    })
  }

  if (!continued) {
    const targetStore = getCopilotStoreForToolCall(params.toolCallId)
    if (targetStore) {
      const state = targetStore.getState()
      if (state.isAwaitingContinuation) {
        const latestTurnStatus = resolveTurnStatusFromToolCalls(state.toolCallsById)
        if (latestTurnStatus !== ACTIVE_TURN_STATUS) {
          targetStore.setState((currentState) => ({
            ...buildChatTurnStatusState(currentState, latestTurnStatus),
            isSendingMessage: false,
            isAwaitingContinuation: false,
          }))

          const currentChat = targetStore.getState().currentChat
          if (currentChat?.reviewSessionId) {
            void targetStore.getState().saveChatMessages(currentChat.reviewSessionId, {
              latestTurnStatus,
            })
          }
        }
      }
    }
  }

  return response
}

// Helper: abort all in-progress client tools and keep message-level tool state aligned.
function abortAllInProgressTools(
  set: any,
  get: () => CopilotStore,
  options?: { includeReview?: boolean }
) {
  try {
    const { toolCallsById } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds: string[] = []
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state as any
      const isTerminal =
        st === ClientToolCallState.success ||
        st === ClientToolCallState.error ||
        st === ClientToolCallState.rejected ||
        st === ClientToolCallState.aborted ||
        (!options?.includeReview && isReviewState(st))
      if (!isTerminal) {
        abortedIds.push(id)
        updatedMap[id] = {
          ...tc,
          state: ClientToolCallState.aborted,
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, (tc as any).params),
        }
      }
    }
    if (abortedIds.length > 0) {
      set((s: CopilotStore) => {
        const nextChatState = buildChatTurnStatusState(s, COMPLETED_TURN_STATUS)
        let nextMessages = s.messages
        for (const toolCallId of abortedIds) {
          nextMessages = updateMessagesForToolCallState(
            nextMessages,
            toolCallId,
            ClientToolCallState.aborted
          )
        }

        const nextCurrentChat = nextChatState.currentChat
          ? {
              ...nextChatState.currentChat,
              messages: nextMessages,
            }
          : null

        return {
          toolCallsById: updatedMap,
          messages: nextMessages,
          chats: nextChatState.chats,
          currentChat: nextCurrentChat,
        }
      })
    }
  } catch {}
}

function autoExecuteEligibleToolsForAccessLevel(
  accessLevel: CopilotStore['accessLevel'],
  get: () => CopilotStore
) {
  if (accessLevel !== 'full') {
    return
  }

  const { toolCallsById } = get()
  const copilotToolIds: string[] = []
  const integrationToolIds: string[] = []

  for (const [id, toolCall] of Object.entries(toolCallsById)) {
    const state = toolCall.state
    const isAwaitingApproval =
      state === ClientToolCallState.pending || state === ClientToolCallState.review

    if (!isAwaitingApproval) {
      continue
    }

    if (isCopilotTool(toolCall.name)) {
      const hasInterrupt = copilotToolHasInterrupt(toolCall.name, id)
      const entersReviewState = copilotToolSupportsState(toolCall.name, ClientToolCallState.review)
      if (shouldAutoExecuteCopilotTool(accessLevel, hasInterrupt, entersReviewState)) {
        copilotToolIds.push(id)
      }
      continue
    }

    if (shouldAutoExecuteIntegrationTool(accessLevel)) {
      integrationToolIds.push(id)
    }
  }

  if (copilotToolIds.length === 0 && integrationToolIds.length === 0) {
    return
  }

  logger.info('[copilot access] auto-executing queued tools after access change', {
    accessLevel,
    copilotToolIds,
    integrationToolIds,
  })

  for (const toolCallId of copilotToolIds) {
    setTimeout(() => {
      const latest = get().toolCallsById[toolCallId]
      if (!latest) return
      const state = latest.state
      if (state !== ClientToolCallState.pending && state !== ClientToolCallState.review) {
        return
      }
      void get().executeCopilotToolCall(toolCallId)
    }, 0)
  }

  for (const toolCallId of integrationToolIds) {
    setTimeout(() => {
      const latest = get().toolCallsById[toolCallId]
      if (!latest) return
      if (latest.state !== ClientToolCallState.pending) {
        return
      }
      void get().executeIntegrationTool(toolCallId)
    }, 0)
  }
}

// Initial state (subset required for UI/streaming)
const initialState = {
  accessLevel: 'limited' as const,
  selectedModel: DEFAULT_COPILOT_RUNTIME_MODEL,
  agentPrefetch: false,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotMessage[],
  isLoadingChats: false,
  isSendingMessage: false,
  isAwaitingContinuation: false,
  isAborting: false,
  abortController: null as AbortController | null,
  inputValue: '',
  planTodos: [] as Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>,
  showPlanTodos: false,
  toolCallsById: {} as Record<string, CopilotToolCall>,
  contextUsage: null,
}

const sharedSessionSyncGuards = new WeakSet<StoreApi<CopilotStore>>()

function buildSharedSessionState(state: CopilotStore) {
  const currentChat = state.currentChat?.reviewSessionId
    ? {
        ...state.currentChat,
        messages: state.messages,
        messageCount: state.messages.length,
      }
    : null
  if (!currentChat) {
    return null
  }

  return {
    currentChat,
    messages: state.messages,
    toolCallsById: state.toolCallsById,
    isSendingMessage: state.isSendingMessage,
    isAwaitingContinuation: state.isAwaitingContinuation,
    isAborting: state.isAborting,
    abortController: state.abortController,
    inputValue: state.inputValue,
    planTodos: state.planTodos,
    showPlanTodos: state.showPlanTodos,
    contextUsage: state.contextUsage,
  }
}

function syncCopilotSessionState(sourceStore: StoreApi<CopilotStore>) {
  const sharedSessionState = buildSharedSessionState(sourceStore.getState())
  if (!sharedSessionState) {
    return
  }

  for (const store of copilotStoreRegistry.values()) {
    if (
      store === sourceStore ||
      store.getState().currentChat?.reviewSessionId !== sharedSessionState.currentChat.reviewSessionId
    ) {
      continue
    }

    sharedSessionSyncGuards.add(store)
    try {
      store.setState((state) => ({
        currentChat: sharedSessionState.currentChat,
        chats: state.chats.map((chat) =>
          chat.reviewSessionId === sharedSessionState.currentChat.reviewSessionId
            ? {
                ...chat,
                title: sharedSessionState.currentChat.title,
                conversationId: sharedSessionState.currentChat.conversationId,
                latestTurnStatus: sharedSessionState.currentChat.latestTurnStatus,
                updatedAt: sharedSessionState.currentChat.updatedAt,
                messages: sharedSessionState.currentChat.messages,
                messageCount: sharedSessionState.currentChat.messageCount,
              }
            : chat
        ),
        messages: sharedSessionState.messages,
        toolCallsById: sharedSessionState.toolCallsById,
        isSendingMessage: sharedSessionState.isSendingMessage,
        isAwaitingContinuation: sharedSessionState.isAwaitingContinuation,
        isAborting: sharedSessionState.isAborting,
        abortController: sharedSessionState.abortController,
        inputValue: sharedSessionState.inputValue,
        planTodos: sharedSessionState.planTodos,
        showPlanTodos: sharedSessionState.showPlanTodos,
        contextUsage: sharedSessionState.contextUsage,
      }))
    } finally {
      sharedSessionSyncGuards.delete(store)
    }
  }
}

function installSharedSessionSync(store: StoreApi<CopilotStore>) {
  store.subscribe((state) => {
    if (!sharedSessionSyncGuards.has(store) && state.currentChat?.reviewSessionId) {
      syncCopilotSessionState(store)
    }
  })
}

function removeCopilotChatFromStores(reviewSessionId: string) {
  let clearedWorkspaceId: string | null | undefined

  for (const store of copilotStoreRegistry.values()) {
    store.setState((state) => {
      const chats = state.chats.filter((chat) => chat.reviewSessionId !== reviewSessionId)
      if (state.currentChat?.reviewSessionId !== reviewSessionId) {
        return { chats }
      }

      clearedWorkspaceId ??= state.currentChat.workspaceId ?? null
      return {
        chats,
        currentChat: null,
        messages: [],
        toolCallsById: {},
        isSendingMessage: false,
        isAwaitingContinuation: false,
        isAborting: false,
        abortController: null,
        inputValue: '',
        planTodos: [],
        showPlanTodos: false,
        contextUsage: null,
      }
    })
  }

  return clearedWorkspaceId
}

const sseHandlers = createSSEHandlers({
  logger,
  schedulePersistCurrentChatState,
})

const createCopilotStoreInstance = (storeChannelId = DEFAULT_COPILOT_CHANNEL_ID) => {
  const store = create<CopilotStore>()(
    devtools((set, get) => ({
      ...initialState,

      // Access policy controls
      setAccessLevel: (accessLevel) => {
        const previousAccessLevel = get().accessLevel
        set({ accessLevel })
        if (previousAccessLevel !== accessLevel) {
          autoExecuteEligibleToolsForAccessLevel(accessLevel, get)
        }
      },

      selectChat: async (chat: CopilotChat) => {
        const { isSendingMessage, isAwaitingContinuation, currentChat } = get()
        if (
          currentChat &&
          currentChat.reviewSessionId !== chat.reviewSessionId &&
          (isSendingMessage || isAwaitingContinuation || isChatTurnInProgress(currentChat))
        ) {
          get().abortMessage()
        }

        // Abort in-progress tools and clear diff when changing chats
        abortAllInProgressTools(set, get)

        // Capture previous chat/messages for optimistic background save after local aborts have settled.
        const previousChat = get().currentChat
        const previousMessages = get().messages
        const normalizedMessages = normalizeMessagesForUI(
          chat.messages || [],
          chat.latestTurnStatus,
          get().accessLevel
        )
        const optimisticToolCallsById = buildPinnedToolCallsById(normalizedMessages, {
          workspaceId: chat.workspaceId,
        })

        rememberCopilotWorkspaceSelection(chat.workspaceId, chat.reviewSessionId)

        // Optimistically set selected chat and normalize messages for UI
        set({
          currentChat: chat,
          messages: normalizedMessages,
          toolCallsById: optimisticToolCallsById,
          planTodos: [],
          showPlanTodos: false,
          contextUsage: null,
          isSendingMessage: isChatTurnInProgress(chat),
          isAwaitingContinuation: isChatTurnInProgress(chat),
          abortController: null,
        })

        // Background-save the previous chat's latest messages before switching (optimistic)
        try {
          if (previousChat && previousChat.reviewSessionId !== chat.reviewSessionId) {
            const dbMessages = validateMessagesForLLM(previousMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reviewSessionId: previousChat.reviewSessionId,
                messages: dbMessages,
                latestTurnStatus: previousChat.latestTurnStatus ?? COMPLETED_TURN_STATUS,
              }),
            }).catch(() => {})
          }
        } catch {}

        // Refresh selected chat from server to ensure we have latest messages/tool calls
        try {
          const reviewSessionId = chat.reviewSessionId
          const response = await fetch(
            `/api/copilot/chat?reviewSessionId=${encodeURIComponent(reviewSessionId)}`
          )
          if (!response.ok) throw new Error(`Failed to fetch latest chat data: ${response.status}`)
          const data = await response.json()
          if (data.success && Array.isArray(data.chats)) {
            const latestChat =
              data.chats.find((c: CopilotChat) => c.reviewSessionId === chat.reviewSessionId) ??
              data.chats[0] ??
              null
            if (latestChat) {
              const normalizedMessages = normalizeMessagesForUI(
                latestChat.messages || [],
                latestChat.latestTurnStatus,
                get().accessLevel
              )
              const toolCallsById = buildPinnedToolCallsById(normalizedMessages, {
                workspaceId: latestChat.workspaceId,
              })

              rememberCopilotWorkspaceSelection(latestChat.workspaceId, latestChat.reviewSessionId)

              set({
                currentChat: latestChat,
                messages: normalizedMessages,
                chats: (get().chats || []).map((c: CopilotChat) =>
                  c.reviewSessionId === chat.reviewSessionId ? latestChat : c
                ),
                contextUsage: null,
                toolCallsById,
                isSendingMessage: isChatTurnInProgress(latestChat),
                isAwaitingContinuation: isChatTurnInProgress(latestChat),
                abortController: null,
              })
              logger.info('[Context Usage] Chat selected, fetching usage')
              await get().fetchContextUsage()
            }
          }
        } catch {}
      },

      createNewChat: async (workspaceId) => {
        const { isSendingMessage, isAwaitingContinuation, currentChat: activeChat } = get()
        if (isSendingMessage || isAwaitingContinuation || isChatTurnInProgress(activeChat)) {
          get().abortMessage()
        }

        // Abort in-progress tools and clear diff on new chat
        abortAllInProgressTools(set, get)

        const currentChat = get().currentChat
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reviewSessionId: currentChat.reviewSessionId,
                messages: dbMessages,
                latestTurnStatus: currentChat.latestTurnStatus ?? COMPLETED_TURN_STATUS,
              }),
            }).catch(() => {})
          } catch {}
        }

        // Generic copilot keeps prior chats in workspace history. "New chat"
        // only clears the active selection so the next send creates a fresh
        // session in the same workspace bucket.
        const selectionWorkspaceId = currentChat?.workspaceId ?? workspaceId ?? null
        rememberCopilotWorkspaceSelection(selectionWorkspaceId, null)

        logger.info('[Context Usage] New chat created, clearing context usage')
        set(() => ({
          currentChat: null,
          messages: [],
          toolCallsById: {},
          isSendingMessage: false,
          isAwaitingContinuation: false,
          abortController: null,
          planTodos: [],
          showPlanTodos: false,
          contextUsage: null,
        }))
      },

      deleteChat: async (reviewSessionId: string) => {
        try {
          // Call delete API
          const response = await fetch('/api/copilot/chat/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewSessionId }),
          })

          if (!response.ok) {
            throw new Error(`Failed to delete chat: ${response.status}`)
          }

          const selectionWorkspaceId = removeCopilotChatFromStores(reviewSessionId)
          if (selectionWorkspaceId !== undefined) {
            rememberCopilotWorkspaceSelection(selectionWorkspaceId, null)
          }

          logger.info('Chat deleted', { reviewSessionId })
        } catch (error) {
          logger.error('Failed to delete chat:', error)
          throw error
        }
      },

      loadChats: async (options) => {
        const { currentChat } = get()
        const resolvedWorkspaceId = options?.workspaceId ?? currentChat?.workspaceId ?? null

        // For now always fetch fresh
        set({ isLoadingChats: true })
        try {
          const params = new URLSearchParams()
          if (resolvedWorkspaceId) {
            params.set('workspaceId', resolvedWorkspaceId)
          }
          const query = params.toString()
          const response = await fetch(query ? `/api/copilot/chat?${query}` : '/api/copilot/chat')
          if (!response.ok) {
            throw new Error(`Failed to fetch chats: ${response.status}`)
          }
          const data = await response.json()
          if (data.success && Array.isArray(data.chats)) {
            set({
              chats: data.chats,
              isLoadingChats: false,
            })

            if (data.chats.length > 0) {
              const { currentChat, isSendingMessage } = get()
              const preferredWorkspaceSelection = getCopilotWorkspaceSelection(resolvedWorkspaceId)
              const currentChatStillExists =
                currentChat &&
                data.chats.some(
                  (c: CopilotChat) => c.reviewSessionId === currentChat.reviewSessionId
                )

              if (currentChatStillExists) {
                const updatedCurrentChat = data.chats.find(
                  (c: CopilotChat) => c.reviewSessionId === currentChat!.reviewSessionId
                )!
                if (isSendingMessage) {
                  const keepTurnActive =
                    get().isAwaitingContinuation || isChatTurnInProgress(currentChat)
                  set({
                    currentChat: {
                      ...updatedCurrentChat,
                      messages: get().messages,
                      latestTurnStatus: keepTurnActive
                        ? ACTIVE_TURN_STATUS
                        : updatedCurrentChat.latestTurnStatus,
                    },
                    isAwaitingContinuation: keepTurnActive,
                  })
                } else {
                  const normalizedMessages = normalizeMessagesForUI(
                    updatedCurrentChat.messages || [],
                    updatedCurrentChat.latestTurnStatus,
                    get().accessLevel
                  )
                  const toolCallsById = buildPinnedToolCallsById(normalizedMessages, {
                    workspaceId: updatedCurrentChat.workspaceId,
                  })

                  set({
                    currentChat: updatedCurrentChat,
                    messages: normalizedMessages,
                    toolCallsById,
                    isSendingMessage: isChatTurnInProgress(updatedCurrentChat),
                    isAwaitingContinuation: isChatTurnInProgress(updatedCurrentChat),
                    abortController: null,
                  })
                }
              } else if (!isSendingMessage) {
                const preferredChat =
                  typeof preferredWorkspaceSelection === 'string'
                    ? (data.chats.find(
                        (chat: CopilotChat) =>
                          chat.reviewSessionId === preferredWorkspaceSelection
                      ) ?? null)
                    : null
                const availableChat =
                  preferredChat ?? (preferredWorkspaceSelection === null ? null : (data.chats[0] ?? null))

                if (availableChat) {
                  const normalizedMessages = normalizeMessagesForUI(
                    availableChat.messages || [],
                    availableChat.latestTurnStatus,
                    get().accessLevel
                  )
                  const toolCallsById = buildPinnedToolCallsById(normalizedMessages, {
                    workspaceId: availableChat.workspaceId,
                  })

                  rememberCopilotWorkspaceSelection(availableChat.workspaceId, availableChat.reviewSessionId)

                  set({
                    currentChat: availableChat,
                    messages: normalizedMessages,
                    toolCallsById,
                    isSendingMessage: isChatTurnInProgress(availableChat),
                    isAwaitingContinuation: isChatTurnInProgress(availableChat),
                    abortController: null,
                  })
                } else {
                  set({
                    currentChat: null,
                    messages: [],
                    toolCallsById: {},
                    isSendingMessage: false,
                    isAwaitingContinuation: false,
                    abortController: null,
                  })
                }
              }
            } else {
              set({
                currentChat: null,
                messages: [],
                toolCallsById: {},
                isSendingMessage: false,
                isAwaitingContinuation: false,
                abortController: null,
              })
            }
          } else {
            throw new Error('Invalid response format')
          }
        } catch (error) {
          set({
            chats: [],
            isLoadingChats: false,
          })
          logger.warn('Failed to load copilot chats', {
            workspaceId: resolvedWorkspaceId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },

      // Send a message (streaming only)
      sendMessage: async (message: string, options = {}) => {
        const { currentChat } = get()
        const {
          fileAttachments,
          contexts,
          messageId,
          runtimeContext,
        } = options as {
          fileAttachments?: MessageFileAttachment[]
          contexts?: ChatContext[]
          messageId?: string
          runtimeContext?: CopilotSendRuntimeContext
        }

        if (!runtimeContext) {
          logger.warn('Skipping copilot send without runtime context')
          return
        }

        const { liveContext, implicitContexts } = runtimeContext

        const resolvedContexts = mergeCopilotContexts({
          explicitContexts: contexts,
          implicitContexts,
        })
        const turnProvenance = buildTurnProvenanceFromContexts(
          resolvedContexts,
          liveContext.workspaceId,
          liveContext.reviewTarget,
          liveContext.workflowId
        )
        const contextsToSend = resolvedContexts.length > 0 ? resolvedContexts : undefined

        const abortController = new AbortController()
        set({ isSendingMessage: true, isAwaitingContinuation: false, abortController })

        const userMessage = createUserMessage(message, fileAttachments, contextsToSend, messageId)
        const streamingMessage = createStreamingMessage()

        const currentMessages = get().messages
        const existingIndex = messageId
          ? currentMessages.findIndex((existingMessage) => existingMessage.id === messageId)
          : -1
        const newMessages =
          existingIndex !== -1
            ? [...currentMessages.slice(0, existingIndex), userMessage, streamingMessage]
            : [...currentMessages, userMessage, streamingMessage]

        const isFirstMessage = get().messages.length === 0 && !currentChat?.title
        set((state) => ({
          messages: newMessages,
          ...buildChatTurnStatusState(state, ACTIVE_TURN_STATUS),
        }))

        if (currentChat?.reviewSessionId) {
          schedulePersistCurrentChatState(get, currentChat.reviewSessionId, ACTIVE_TURN_STATUS)
        }

        if (isFirstMessage) {
          const optimisticTitle = message.length > 50 ? `${message.substring(0, 47)}...` : message
          set((state) => ({
            currentChat: state.currentChat
              ? { ...state.currentChat, title: optimisticTitle }
              : state.currentChat,
          }))
        }

        try {
          const requestReviewSessionId = currentChat?.reviewSessionId
          const requestModel = get().selectedModel as CopilotStore['selectedModel']
          const requestProvider = resolveCopilotRuntimeProvider(requestModel)

          const result = await sendStreamingMessage({
            message,
            userMessageId: userMessage.id,
            reviewSessionId: requestReviewSessionId,
            workspaceId: liveContext.workspaceId ?? undefined,
            model: requestModel,
            provider: requestProvider,
            prefetch: get().agentPrefetch,
            fileAttachments,
            contexts: contextsToSend,
            abortSignal: abortController.signal,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(
              result.stream,
              streamingMessage.id,
              false,
              turnProvenance
            )
          } else {
            if (result.error === 'Request was aborted') {
              return
            }

            // Check for specific status codes and provide custom messages
            let errorContent = result.error || 'Failed to send message'
            if (result.status === 401) {
              errorContent =
                '_Unauthorized request. You need a valid API key to use the copilot. You can get one by going to [TradingGoose.ai](https://tradinggoose.ai) settings and generating one there._'
            } else if (result.status === 402) {
              errorContent =
                '_Usage limit exceeded. To continue using this service, upgrade your plan or top up on credits._'
            } else if (result.status === 403) {
              errorContent =
                '_Provider config not allowed for non-enterprise users. Please remove the provider config and try again_'
            } else if (result.status === 426) {
              errorContent =
                '_Please upgrade to the latest version of the TradingGoose platform to continue using the copilot._'
            } else if (result.status === 429) {
              errorContent = '_Provider rate limit exceeded. Please try again later._'
            }

            const errorMessage = createErrorMessage(streamingMessage.id, errorContent)
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === streamingMessage.id ? errorMessage : m
              ),
              ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
              isSendingMessage: false,
              isAwaitingContinuation: false,
              abortController: null,
            }))

            const failedChat = get().currentChat
            if (failedChat?.reviewSessionId) {
              await get().saveChatMessages(failedChat.reviewSessionId, {
                latestTurnStatus: COMPLETED_TURN_STATUS,
              })
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return
          const errorMessage = createErrorMessage(
            streamingMessage.id,
            'Sorry, I encountered an error while processing your message. Please try again.'
          )
          set((state) => ({
            messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
            ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
            isSendingMessage: false,
            isAwaitingContinuation: false,
            abortController: null,
          }))

          const failedChat = get().currentChat
          if (failedChat?.reviewSessionId) {
            await get().saveChatMessages(failedChat.reviewSessionId, {
              latestTurnStatus: COMPLETED_TURN_STATUS,
            })
          }
        }
      },

      // Abort streaming
      abortMessage: () => {
        const { abortController, currentChat, isSendingMessage, messages, toolCallsById } = get()
        const hasActiveToolCalls = hasUiActiveToolCalls(toolCallsById)
        if (!isSendingMessage && !isChatTurnInProgress(currentChat) && !hasActiveToolCalls) return
        set({ isAborting: true })
        try {
          abortController?.abort()
          const lastMessage = messages[messages.length - 1]
          if (lastMessage && lastMessage.role === 'assistant') {
            const textContent =
              lastMessage.contentBlocks
                ?.filter((b) => b.type === 'text')
                .map((b: any) => b.content)
                .join('') || ''
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === lastMessage.id
                  ? { ...msg, content: textContent.trim() || 'Message was aborted' }
                  : msg
              ),
              ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
              isSendingMessage: false,
              isAwaitingContinuation: false,
              isAborting: false,
              abortController: null,
            }))
          } else {
            set((state) => ({
              ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
              isSendingMessage: false,
              isAwaitingContinuation: false,
              isAborting: false,
              abortController: null,
            }))
          }

          // Immediately put all in-progress tools into aborted state
          abortAllInProgressTools(set, get, { includeReview: true })

          const { currentChat } = get()
          if (currentChat) {
            void get().saveChatMessages(currentChat.reviewSessionId, {
              latestTurnStatus: COMPLETED_TURN_STATUS,
            })
          }

          // Fetch context usage after abort
          logger.info('[Context Usage] Message aborted, fetching usage')
          get()
            .fetchContextUsage()
            .catch((err) => {
              logger.warn('[Context Usage] Failed to fetch after abort', err)
            })
        } catch {
          set((state) => ({
            ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
            isSendingMessage: false,
            isAwaitingContinuation: false,
            isAborting: false,
            abortController: null,
          }))
        }
      },

      // Tool-call related APIs are stubbed for now
      setToolCallState: (toolCall: any, newState: any) => {
        try {
          const id: string | undefined = toolCall?.id
          if (!id) return
          const map = { ...get().toolCallsById }
          const current = map[id]
          if (!current) return
          // Preserve rejected state from being overridden
          if (
            isRejectedState(current.state) &&
            (newState === 'success' || newState === ClientToolCallState.success)
          ) {
            return
          }
          let norm: ClientToolCallState = current.state
          if (newState === 'executing') norm = ClientToolCallState.executing
          else if (newState === 'errored' || newState === 'error') norm = ClientToolCallState.error
          else if (newState === 'rejected') norm = ClientToolCallState.rejected
          else if (newState === 'pending') norm = ClientToolCallState.pending
          else if (newState === 'success' || newState === 'accepted')
            norm = ClientToolCallState.success
          else if (newState === 'aborted') norm = ClientToolCallState.aborted
          else if (typeof newState === 'number') norm = newState as unknown as ClientToolCallState
          map[id] = {
            ...current,
            state: norm,
            display: resolveToolDisplay(current.name, norm, id, current.params),
          }
          set({ toolCallsById: map })
        } catch {}
      },
      updatePreviewToolCallState: (
        toolCallState: 'accepted' | 'rejected' | 'error',
        toolCallId?: string
      ) => {
        const stateMap: Record<string, ClientToolCallState> = {
          accepted: ClientToolCallState.success,
          rejected: ClientToolCallState.rejected,
          error: ClientToolCallState.error,
        }
        const targetState = stateMap[toolCallState] || ClientToolCallState.success
        const { toolCallsById } = get()
        // Determine target tool
        let id = toolCallId
        if (!id) {
          // Prefer the latest assistant message's build/edit tool_call
          const messages = get().messages
          outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
            const m = messages[mi]
            if (m.role !== 'assistant' || !m.contentBlocks) continue
            const blocks = m.contentBlocks as any[]
            for (let bi = blocks.length - 1; bi >= 0; bi--) {
              const b = blocks[bi]
              if (b?.type === 'tool_call') {
                const tn = b.toolCall?.name
                if (tn === 'edit_workflow') {
                  id = b.toolCall?.id
                  break outer
                }
              }
            }
          }
          // Fallback to map if not found in messages
          if (!id) {
            const candidates = Object.values(toolCallsById).filter(
              (t) => t.name === 'edit_workflow'
            )
            id = candidates.length ? candidates[candidates.length - 1].id : undefined
          }
        }
        if (!id) return
        const current = toolCallsById[id]
        if (!current) return
        // Do not override a rejected tool with success
        if (isRejectedState(current.state) && targetState === ClientToolCallState.success) {
          return
        }

        // Update store map
        const updatedMap = { ...toolCallsById }
        const updatedDisplay = resolveToolDisplay(current.name, targetState, id, current.params)
        updatedMap[id] = {
          ...current,
          state: targetState,
          display: updatedDisplay,
        }
        set({ toolCallsById: updatedMap })

        // Update inline content block in the latest assistant message
        set((s) => {
          const messages = [...s.messages]
          for (let mi = messages.length - 1; mi >= 0; mi--) {
            const m = messages[mi]
            if (m.role !== 'assistant' || !m.contentBlocks) continue
            let changed = false
            const blocks = m.contentBlocks.map((b: any) => {
              if (b.type === 'tool_call' && b.toolCall?.id === id) {
                changed = true
                const prev = b.toolCall || {}
                return {
                  ...b,
                  toolCall: {
                    ...prev,
                    id,
                    name: current.name,
                    state: targetState,
                    display: updatedDisplay,
                    params: current.params,
                  },
                }
              }
              return b
            })
            if (changed) {
              messages[mi] = { ...m, contentBlocks: blocks }
              break
            }
          }
          return { messages }
        })

        // Notify backend mark-complete to finalize tool server-side
        try {
          postCopilotMarkComplete({
            toolCallId: id,
            toolName: current.name,
            status:
              targetState === ClientToolCallState.success
                ? 200
                : targetState === ClientToolCallState.rejected
                  ? REJECTED_TOOL_COMPLETION_STATUS
                  : 500,
            message: toolCallState,
            ...(targetState === ClientToolCallState.rejected ? { data: { rejected: true } } : {}),
          })
            .then(async (res) => {
              if (!res.ok) {
                let body: string | undefined
                try {
                  body = await res.text()
                } catch {}
                logger.warn('[mark-complete] proxy responded non-OK', {
                  toolCallId: id,
                  toolName: current.name,
                  status: res.status,
                  body: body?.slice(0, 200),
                })
              }
            })
            .catch((error) => {
              logger.warn('[mark-complete] proxy fetch failed', {
                toolCallId: id,
                toolName: current.name,
                error: error instanceof Error ? error.message : String(error),
              })
            })
        } catch {}
      },

      saveChatMessages: async (chatId: string, options) => {
        const { currentChat, messages } = get()
        const targetChatId = chatId || currentChat?.reviewSessionId
        if (!targetChatId) return
        if (currentChat?.reviewSessionId && currentChat.reviewSessionId !== targetChatId) return

        try {
          const dbMessages = validateMessagesForLLM(messages)
          const latestTurnStatus =
            options?.latestTurnStatus ??
            currentChat?.latestTurnStatus ??
            (get().isSendingMessage ? ACTIVE_TURN_STATUS : COMPLETED_TURN_STATUS)
          if (latestTurnStatus !== ACTIVE_TURN_STATUS) {
            clearPendingChatPersistence(targetChatId)
          }
          await fetch('/api/copilot/chat/update-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reviewSessionId: targetChatId,
              messages: dbMessages,
              latestTurnStatus,
            }),
          })
        } catch (error) {
          logger.warn('Failed to persist copilot chat messages', {
            chatId: targetChatId,
            latestTurnStatus: options?.latestTurnStatus,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },

      // Handle streaming response
      handleStreamingResponse: async (
        stream: ReadableStream,
        assistantMessageId: string,
        isContinuation = false,
        turnProvenance?: CopilotToolExecutionProvenance
      ) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        const timeoutId = setTimeout(() => {
          logger.warn('Stream timeout reached, completing response')
          reader.cancel()
        }, 600000)

        try {
          const context: StreamingContext = {
            messageId: assistantMessageId,
            provenance: turnProvenance,
            contentBlocks: [],
            textBlocksByItemId: new Map(),
            thinkingBlocksByItemId: new Map(),
          }

          if (isContinuation) {
            const { messages } = get()
            const existingMessage = messages.find((m) => m.id === assistantMessageId)
            if (existingMessage) {
              context.contentBlocks = existingMessage.contentBlocks
                ? [...existingMessage.contentBlocks]
                : []
              hydrateStreamingBlockIndexes(context)
            }
          }

          for await (const data of parseSSEStream(reader, decoder, logger)) {
            const { abortController } = get()
            if (abortController?.signal.aborted) break

            const handler = sseHandlers[data.type] || sseHandlers.default
            await handler(data, context, get, set)
            if (context.streamComplete) break
          }

          if (sseHandlers.stream_end) sseHandlers.stream_end({}, context, get, set)

          resetStreamingQueue()
          const finalContent = getStreamingAssistantContent(context)
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: finalContent,
                    contentBlocks: context.contentBlocks,
                  }
                : msg
            ),
            ...buildChatTurnStatusState(
              state,
              context.awaitingTools ? ACTIVE_TURN_STATUS : COMPLETED_TURN_STATUS
            ),
            isSendingMessage: context.awaitingTools === true,
            isAwaitingContinuation: context.awaitingTools === true,
            abortController: null,
          }))

          if (context.newReviewSessionId && !get().currentChat) {
            await get().handleNewReviewSessionCreation(
              context.newReviewSessionId,
              context.provenance?.workspaceId ?? null
            )
          }

          await flushPendingAutoExecutionToolCalls(context, get, logger)

          const latestTurnStatus = resolveStreamPausedTurnStatus(
            get().toolCallsById,
            context.awaitingTools === true
          )

          set((state) => ({
            ...buildChatTurnStatusState(state, latestTurnStatus),
            isSendingMessage: latestTurnStatus === ACTIVE_TURN_STATUS,
            isAwaitingContinuation:
              latestTurnStatus === ACTIVE_TURN_STATUS && context.awaitingTools === true,
          }))

          // Persist full message state (including contentBlocks) to database
          const { currentChat } = get()
          if (currentChat) {
            await get().saveChatMessages(currentChat.reviewSessionId, {
              latestTurnStatus,
            })
          }

          // Post copilot_stats record (input/output tokens can be null for now)
          try {
            // Removed: stats sending now occurs only on accept/reject with minimal payload
          } catch {}

          // Fetch context usage after response completes
          if (!context.awaitingTools) {
            logger.info('[Context Usage] Stream completed, fetching usage')
            const billingOptions = assistantMessageId
              ? {
                  bill: true,
                  assistantMessageId,
                  workflowId: context.provenance?.workflowId,
                }
              : undefined
            await get().fetchContextUsage(billingOptions)
          }
        } finally {
          clearTimeout(timeoutId)
        }
      },

      // Handle new chat creation from stream
      handleNewReviewSessionCreation: async (
        newReviewSessionId: string,
        workspaceId?: string | null
      ) => {
        const newChat: CopilotChat = {
          reviewSessionId: newReviewSessionId,
          workspaceId: workspaceId ?? null,
          entityKind: COPILOT_SESSION_KIND,
          entityId: null,
          draftSessionId: null,
          latestTurnStatus: ACTIVE_TURN_STATUS,
          title: null,
          messages: get().messages,
          messageCount: get().messages.length,
          conversationId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        // Abort any in-progress tools and clear diff on new chat creation
        abortAllInProgressTools(set, get)

        rememberCopilotWorkspaceSelection(newChat.workspaceId, newReviewSessionId)

        set({
          currentChat: newChat,
          chats: [newChat, ...(get().chats || [])],
          planTodos: [],
          showPlanTodos: false,
        })

        schedulePersistCurrentChatState(get, newReviewSessionId, ACTIVE_TURN_STATUS)
      },

      cleanup: () => {
        const { isSendingMessage, isAwaitingContinuation, currentChat } = get()
        if (isSendingMessage || isAwaitingContinuation || isChatTurnInProgress(currentChat)) {
          get().abortMessage()
        }
        resetStreamingQueue()
        // Clear any diff on cleanup
      },

      reset: () => {
        get().cleanup()
        // Abort in-progress tools prior to reset
        abortAllInProgressTools(set, get)
        set({ ...initialState, accessLevel: get().accessLevel })
      },

      // Input controls
      setInputValue: (value: string) => set({ inputValue: value }),

      // Todo list (UI only)
      setPlanTodos: (todos) => set({ planTodos: todos, showPlanTodos: true }),
      updatePlanTodoStatus: (id, status) => {
        set((state) => {
          const updated = state.planTodos.map((t) =>
            t.id === id
              ? { ...t, completed: status === 'completed', executing: status === 'executing' }
              : t
          )
          return { planTodos: updated }
        })
      },
      closePlanTodos: () => set({ showPlanTodos: false }),

      setSelectedModel: async (model) => {
        logger.info('[Context Usage] Model changed', { from: get().selectedModel, to: model })
        set({ selectedModel: model })
        // Fetch context usage after model switch
        await get().fetchContextUsage()
      },
      setAgentPrefetch: (prefetch) => set({ agentPrefetch: prefetch }),

      // Fetch context usage from copilot API
      fetchContextUsage: async (options?: {
        bill?: boolean
        assistantMessageId?: string
        workflowId?: string
      }) => {
        try {
          const { bill = false, assistantMessageId, workflowId } = options ?? {}
          const { currentChat, selectedModel } = get()
          const activeWorkflowId = workflowId
          const selectedProvider = resolveCopilotRuntimeProvider(selectedModel)
          logger.info('[Context Usage] Starting fetch', {
            hasConversationId: !!currentChat?.conversationId,
            hasWorkflowId: !!activeWorkflowId,
            conversationId: currentChat?.conversationId,
            workflowId: activeWorkflowId,
            model: selectedModel,
            provider: selectedProvider,
            bill,
            assistantMessageId,
          })

          if (!currentChat) {
            set({ contextUsage: null })
            logger.info('[Context Usage] Skipping: missing current chat')
            return
          }

          if (!currentChat.conversationId) {
            set({ contextUsage: null })
            logger.info('[Context Usage] Skipping: missing conversationId', {
              hasConversationId: !!currentChat?.conversationId,
            })
            return
          }

          const requestPayload: Record<string, any> = {
            kind: 'context',
            conversationId: currentChat.conversationId,
            model: selectedModel,
            provider: selectedProvider,
            // Context usage is conversation-scoped. Forward the current workflow
            // only as supplemental runtime context when one exists.
            ...(activeWorkflowId ? { workflowId: activeWorkflowId } : {}),
          }
          if (bill && assistantMessageId) {
            requestPayload.bill = true
            requestPayload.assistantMessageId = assistantMessageId
            requestPayload.billingModel = selectedModel
          }

          logger.info('[Context Usage] Calling API', requestPayload)

          // Call the backend API route which proxies to copilot
          const response = await fetch('/api/copilot/usage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
          })

          logger.info('[Context Usage] API response', { status: response.status, ok: response.ok })

          if (response.ok) {
            const data = await response.json()
            logger.info('[Context Usage] Received data', data)

            // Check for either tokensUsed or usage field
            if (
              data.tokensUsed !== undefined ||
              data.usage !== undefined ||
              data.percentage !== undefined
            ) {
              const contextUsage = {
                usage: data.tokensUsed || data.usage || 0,
                percentage: data.percentage || 0,
                model: data.model || selectedModel,
                contextWindow: data.contextWindow || data.context_window || 0,
                when: data.when || 'end',
                estimatedTokens: data.tokensUsed || data.estimated_tokens || data.estimatedTokens,
              }
              set({ contextUsage })
              logger.info('[Context Usage] Updated store', contextUsage)
            } else {
              logger.warn('[Context Usage] No usage data in response', data)
            }
          } else {
            const errorText = await response.text().catch(() => 'Unable to read error')
            logger.warn('[Context Usage] API call failed', {
              status: response.status,
              error: errorText,
            })
          }
        } catch (err) {
          logger.error('[Context Usage] Error fetching:', err)
        }
      },

      executeCopilotToolCall: async (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        const provenance = toolCall?.provenance
        if (!toolCall) return

        const { id, name, params } = toolCall
        const executionContext = createExecutionContext({
          toolCallId: id,
          toolName: name,
          provenance: provenance ?? {},
        })
        const preparedArgs = prepareCopilotToolArgs(name, params, executionContext)
        const targetStore = getCopilotStore(storeChannelId)

        applyToolStateUpdate(targetStore, id, ClientToolCallState.executing)
        logger.info('[toolCallsById] pending → executing (copilot tool)', { id, name })

        if (isServerManagedCopilotTool(name)) {
          try {
            const serverContext = {
              ...(provenance?.contextWorkflowId
                ? { contextWorkflowId: provenance.contextWorkflowId }
                : {}),
            }
            const result = await executeCopilotServerTool({
              toolName: name,
              payload: preparedArgs,
              context: serverContext,
            })
            const logicalSuccess =
              !result ||
              typeof result !== 'object' ||
              !('success' in result) ||
              (result as any).success !== false

            const currentToolCall = get().toolCallsById[id]
            if (
              isRejectedState(currentToolCall?.state) ||
              isReviewState(currentToolCall?.state) ||
              isBackgroundState(currentToolCall?.state)
            ) {
              return
            }

            applyToolStateUpdate(
              targetStore,
              id,
              logicalSuccess ? ClientToolCallState.success : ClientToolCallState.error
            )

            if (logicalSuccess && name === 'set_environment_variables') {
              try {
                await useEnvironmentStore.getState().loadEnvironmentVariables()
              } catch (error) {
                logger.warn('Failed to refresh environment store after setting variables', {
                  error,
                })
              }
            }

            const completionMessage =
              typeof (result as any)?.message === 'string'
                ? (result as any).message
                : resolveToolDisplay(
                    name,
                    logicalSuccess ? ClientToolCallState.success : ClientToolCallState.error,
                    id,
                    params
                  )?.text

            try {
              await postCopilotMarkComplete({
                toolCallId: id,
                toolName: name || 'unknown_tool',
                status: logicalSuccess ? 200 : 500,
                message: completionMessage,
                data: result,
              })
            } catch {}
            return
          } catch (error) {
            const errorMap = { ...get().toolCallsById }
            if (
              isRejectedState(errorMap[id]?.state) ||
              isReviewState(errorMap[id]?.state) ||
              isBackgroundState(errorMap[id]?.state)
            ) {
              return
            }

            const message = error instanceof Error ? error.message : String(error)
            applyToolStateUpdate(targetStore, id, ClientToolCallState.error)

            try {
              await postCopilotMarkComplete({
                toolCallId: id,
                toolName: name || 'unknown_tool',
                status: getCopilotServerToolErrorStatus(error) ?? 500,
                message,
              })
            } catch {}
            logger.error('Copilot server tool execution failed', { id, name, error })
            return
          }
        }

        const instance = ensureClientToolInstance(name, id) as any
        if (!instance) {
          applyToolStateUpdate(targetStore, id, ClientToolCallState.error)
          await reportClientManagedToolFailure({
            id,
            name,
            message: 'Client-managed copilot tool instance not found',
          })
          logger.error('Client-managed copilot tool instance not found', { id, name })
          return
        }

        try {
          if (typeof instance.hydratePersistedToolCall === 'function') {
            instance.hydratePersistedToolCall(toolCallsById[id])
          }
          bindClientToolExecutionContext(id, executionContext)
          if (typeof instance.handleUserAction === 'function') {
            await instance.handleUserAction(preparedArgs)
          } else if (
            instance.getInterruptDisplays?.() &&
            typeof instance.handleAccept === 'function'
          ) {
            await instance.handleAccept(preparedArgs)
          } else {
            await instance.execute(preparedArgs)
          }
          syncClientToolInstanceState(id, instance)
        } catch (error) {
          const errorMap = { ...get().toolCallsById }
          if (
            isRejectedState(errorMap[id]?.state) ||
            isReviewState(errorMap[id]?.state) ||
            isBackgroundState(errorMap[id]?.state)
          ) {
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          applyToolStateUpdate(targetStore, id, ClientToolCallState.error)
          await reportClientManagedToolFailure({
            id,
            name,
            message,
            instance,
          })
          logger.error('Client-managed copilot tool execution failed', { id, name, error })
        }
      },

      skipCopilotToolCall: async (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        if (!toolCall) return

        const { id, name } = toolCall
        const targetStore = getCopilotStore(storeChannelId)

        if (isServerManagedCopilotTool(name)) {
          applyToolStateUpdate(targetStore, id, ClientToolCallState.rejected)

          postCopilotMarkComplete({
            toolCallId: id,
            toolName: name || 'unknown_tool',
            status: REJECTED_TOOL_COMPLETION_STATUS,
            message: 'Tool execution was skipped by the user',
            data: { rejected: true, skipped: true },
          }).catch(() => {})
          return
        }

        const instance = ensureClientToolInstance(name, id) as any
        if (instance?.handleReject) {
          await instance.handleReject()
          return
        }

        applyToolStateUpdate(targetStore, id, ClientToolCallState.rejected)
      },

      executeIntegrationTool: async (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        const workflowId = toolCall?.provenance?.workflowId
        if (!toolCall || !workflowId) return

        const { id, name, params } = toolCall
        const targetStore = getCopilotStore(storeChannelId)

        applyToolStateUpdate(targetStore, id, ClientToolCallState.executing)
        logger.info('[toolCallsById] pending → executing (integration tool)', { id, name })

        try {
          const res = await fetch('/api/copilot/execute-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toolCallId: id,
              toolName: name,
              arguments: params || {},
              workflowId,
            }),
          })

          let result: any = null
          try {
            result = await res.json()
          } catch {}

          const success =
            res.ok && result?.success && result?.result && result.result.success === true
          const currentToolCall = get().toolCallsById[id]
          if (
            isRejectedState(currentToolCall?.state) ||
            isReviewState(currentToolCall?.state) ||
            isBackgroundState(currentToolCall?.state)
          ) {
            return
          }

          applyToolStateUpdate(
            targetStore,
            id,
            success ? ClientToolCallState.success : ClientToolCallState.error
          )
          logger.info(
            `[toolCallsById] executing → ${success ? 'success' : 'error'} (integration)`,
            { id, name }
          )

          try {
            await postCopilotMarkComplete({
              toolCallId: id,
              toolName: name || 'unknown_tool',
              status: success ? 200 : 500,
              message: success
                ? result?.result?.output?.content
                : result?.result?.error || result?.error || 'Tool execution failed',
              data: success
                ? result?.result?.output
                : {
                    error: result?.result?.error || result?.error,
                    output: result?.result?.output,
                  },
            })
          } catch {}
        } catch (error) {
          const errorMap = { ...get().toolCallsById }
          if (
            isRejectedState(errorMap[id]?.state) ||
            isReviewState(errorMap[id]?.state) ||
            isBackgroundState(errorMap[id]?.state)
          ) {
            return
          }
          applyToolStateUpdate(targetStore, id, ClientToolCallState.error)
          logger.error('Integration tool execution failed', { id, name, error })
        }
      },

      skipIntegrationTool: (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        if (!toolCall) return

        const { id, name } = toolCall

        applyToolStateUpdate(getCopilotStore(storeChannelId), id, ClientToolCallState.rejected)
        logger.info('[toolCallsById] pending → rejected (integration tool skipped)', { id, name })

        postCopilotMarkComplete({
          toolCallId: id,
          toolName: name || 'unknown_tool',
          status: REJECTED_TOOL_COMPLETION_STATUS,
          message: 'Tool execution skipped by user',
          data: { rejected: true, skipped: true },
        }).catch(() => {})
      },
    }))
  )

  installSharedSessionSync(store)
  return store
}

export const DEFAULT_COPILOT_CHANNEL_ID = 'default'

const copilotStoreRegistry = new Map<string, StoreApi<CopilotStore>>()
const defaultCopilotStore = createCopilotStoreInstance(DEFAULT_COPILOT_CHANNEL_ID)
copilotStoreRegistry.set(DEFAULT_COPILOT_CHANNEL_ID, defaultCopilotStore)

export const getCopilotStore = (channelId = DEFAULT_COPILOT_CHANNEL_ID) => {
  if (!copilotStoreRegistry.has(channelId)) {
    copilotStoreRegistry.set(channelId, createCopilotStoreInstance(channelId))
  }

  return copilotStoreRegistry.get(channelId)!
}

const findStoreForToolCall = (toolCallId: string) => {
  for (const store of copilotStoreRegistry.values()) {
    if (store.getState().toolCallsById[toolCallId]) {
      return store
    }
  }
  return undefined
}

registerCopilotStoreForToolCallResolver(
  (toolCallId) => findStoreForToolCall(toolCallId) ?? defaultCopilotStore
)

registerCopilotMarkCompleteContinuationHandler(async ({ toolCallId, response }) => {
  const targetStore = getCopilotStoreForToolCall(toolCallId)
  const turnProvenance = targetStore.getState().toolCallsById[toolCallId]?.provenance
  const assistantMessageId = findAssistantMessageIdForToolCall(
    targetStore.getState().messages,
    toolCallId
  )

  if (!assistantMessageId || !response.body) {
    logger.warn('Skipping copilot continuation stream; assistant message not found', {
      toolCallId,
      hasBody: !!response.body,
    })
    return
  }

  await targetStore
    .getState()
    .handleStreamingResponse(response.body, assistantMessageId, true, turnProvenance)
})

const CopilotStoreContext = createContext<StoreApi<CopilotStore> | null>(null)

export function CopilotStoreProvider({
  channelId = DEFAULT_COPILOT_CHANNEL_ID,
  children,
}: {
  channelId?: string
  children: ReactNode
}) {
  const store = useMemo(() => getCopilotStore(channelId), [channelId])

  return createElement(CopilotStoreContext.Provider, { value: store }, children)
}

const identitySelector = (state: CopilotStore) => state

export function useCopilotStore<T = CopilotStore>(
  selector?: (state: CopilotStore) => T,
  equalityFn?: (a: T, b: T) => boolean
) {
  const store = useContext(CopilotStoreContext) ?? defaultCopilotStore
  const resolvedSelector = selector ?? (identitySelector as unknown as (state: CopilotStore) => T)
  return equalityFn
    ? useStoreWithEqualityFn(store, resolvedSelector, equalityFn)
    : useStore(store, resolvedSelector)
}

export function useCopilotStoreApi(channelId?: string) {
  const storeFromContext = useContext(CopilotStoreContext)
  if (!channelId && storeFromContext) {
    return storeFromContext
  }
  return getCopilotStore(channelId)
}

function applyToolStateUpdate(
  targetStore: StoreApi<CopilotStore>,
  toolCallId: string,
  mapped: ClientToolCallState,
  options?: { result?: any }
) {
  const state = targetStore.getState()
  const current = state.toolCallsById[toolCallId]
  if (!current) return

  const isTerminal = (toolState: ClientToolCallState) =>
    toolState === ClientToolCallState.success ||
    toolState === ClientToolCallState.error ||
    toolState === ClientToolCallState.rejected ||
    toolState === ClientToolCallState.aborted ||
    toolState === ClientToolCallState.review ||
    toolState === ClientToolCallState.background

  if (isTerminal(current.state) && !isTerminal(mapped)) {
    return
  }

  if (
    (current.state === ClientToolCallState.executing && mapped === ClientToolCallState.pending) ||
    (current.state === ClientToolCallState.pending && mapped === ClientToolCallState.generating)
  ) {
    return
  }

  const hasResultUpdate = options?.result !== undefined && current.result !== options.result
  if (mapped === current.state && !hasResultUpdate) return

  const updated = {
    ...state.toolCallsById,
    [toolCallId]: {
      ...current,
      state: mapped,
      display: resolveToolDisplay(current.name, mapped, toolCallId, current.params),
      ...(hasResultUpdate ? { result: options?.result } : {}),
    },
  }
  const updatedMessages = updateMessagesForToolCallState(
    state.messages,
    toolCallId,
    mapped,
    options
  )
  const latestTurnStatus = resolveStoreTurnActivityState(state, updated)
  const nextChatState = buildChatTurnStatusState(state, latestTurnStatus)
  const nextCurrentChat = nextChatState.currentChat
    ? {
        ...nextChatState.currentChat,
        messages: updatedMessages,
      }
    : nextChatState.currentChat

  targetStore.setState({
    toolCallsById: updated,
    messages: updatedMessages,
    chats: nextChatState.chats,
    isSendingMessage: latestTurnStatus === ACTIVE_TURN_STATUS || state.isAwaitingContinuation,
    ...(nextCurrentChat ? { currentChat: nextCurrentChat } : {}),
  })

  const shouldPersist =
    mapped === ClientToolCallState.success ||
    mapped === ClientToolCallState.error ||
    mapped === ClientToolCallState.aborted ||
    mapped === ClientToolCallState.rejected ||
    mapped === ClientToolCallState.review ||
    mapped === ClientToolCallState.background

  if (!shouldPersist) {
    return
  }

  const currentChat = targetStore.getState().currentChat
  if (currentChat?.reviewSessionId) {
    void targetStore.getState().saveChatMessages(currentChat.reviewSessionId, {
      latestTurnStatus,
    })
  }
}

function syncClientToolInstanceState(toolCallId: string, instance: any) {
  const nextState = instance?.getState?.()
  if (!nextState) {
    return
  }

  const targetStore = findStoreForToolCall(toolCallId) ?? defaultCopilotStore
  const result = instance?.persistedToolCall?.result
  applyToolStateUpdate(
    targetStore,
    toolCallId,
    nextState as ClientToolCallState,
    result !== undefined ? { result } : undefined
  )
}

// Sync class-based tool instance state changes back into the store map
try {
  registerToolStateSync((toolCallId: string, nextState: any, options?: { result?: any }) => {
    const targetStore = findStoreForToolCall(toolCallId) ?? defaultCopilotStore
    const current = targetStore.getState().toolCallsById[toolCallId]
    if (!current) return
    let mapped: ClientToolCallState = current.state
    if (nextState === 'executing') mapped = ClientToolCallState.executing
    else if (nextState === 'pending') mapped = ClientToolCallState.pending
    else if (nextState === 'success' || nextState === 'accepted')
      mapped = ClientToolCallState.success
    else if (nextState === 'error' || nextState === 'errored') mapped = ClientToolCallState.error
    else if (nextState === 'rejected') mapped = ClientToolCallState.rejected
    else if (nextState === 'aborted') mapped = ClientToolCallState.aborted
    else if (nextState === 'review') mapped = ClientToolCallState.review
    else if (nextState === 'background') mapped = ClientToolCallState.background
    else if (typeof nextState === 'number') mapped = nextState as unknown as ClientToolCallState
    applyToolStateUpdate(targetStore, toolCallId, mapped, options)
  })
} catch {}
