'use client'

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
} from 'react'
import type { StoreApi } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createWithEqualityFn as create, useStoreWithEqualityFn } from 'zustand/traditional'
import { shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { mergeCopilotContexts } from '@/lib/copilot/chat-contexts'
import type { CopilotEvent, CopilotRequest, Pending } from '@/lib/copilot/native/contract'
import { readNativeEvents } from '@/lib/copilot/native/stream'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { collectCopilotToolContexts } from '@/lib/copilot/tool-context'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  disposeAllClientTools,
  disposeClientToolsExcept,
  registerToolStateSync,
  unregisterClientTool,
} from '@/lib/copilot/tools/client/manager'
import { isCopilotServerToolReviewResult } from '@/lib/copilot/tools/client/server-tool-response'
import { isServerToolReviewRejectedResult } from '@/lib/copilot/tools/shared/review-result'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { parseCopilotWorkspaceChannelId } from './channel-id'
import { projectNativeHistory } from './history'
import {
  listNativeHistory,
  listNativeThreads,
  NativeCommandError,
  postNativeCommand,
  readNativeCommand,
  readNativeCommandResponse,
} from './native-api'
import { registerCopilotStoreForToolCallResolver } from './store-access'
import {
  buildPlanTodosFromMessages,
  createStreamingMessage,
  createUserMessage,
  updateMessagesForToolCallState,
} from './store-messages'
import { buildTurnProvenanceFromContexts } from './store-provenance'
import { hasUiActiveToolCalls } from './store-state'
import {
  applyNativeCancellation,
  applyNativeEvent,
  displayNativePending,
  replaceNativeText,
  settleDisplayOnlyTools,
} from './streaming'
import {
  bindClientToolExecutionContext,
  createExecutionContext,
  ensureClientToolInstance,
  handleCopilotServerToolSuccess,
  isCopilotTool,
  isGatedTool,
  isServerManagedCopilotTool,
  resolveToolDisplay,
} from './tool-registry'
import type {
  CopilotChat,
  CopilotDraft,
  CopilotStore,
  CopilotToolExecutionProvenance,
} from './types'
import {
  getCopilotWorkspaceSelection,
  rememberCopilotWorkspaceSelection,
  resetCopilotWorkspaceSelectionState,
} from './workspace-selection'

const emptyDraft = (): CopilotDraft => ({ text: '', contexts: [] })
const businessContext = (provenance?: CopilotToolExecutionProvenance) =>
  provenance
    ? {
        ...(provenance.contextEntityKind
          ? { contextEntityKind: provenance.contextEntityKind }
          : {}),
        ...(provenance.contextEntityId ? { contextEntityId: provenance.contextEntityId } : {}),
        ...(provenance.workspaceId ? { workspaceId: provenance.workspaceId } : {}),
      }
    : undefined
const initialState = {
  accessLevel: 'limited' as const,
  selectedModel: null as string | null,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotStore['messages'],
  conversationWorkspaceId: null as string | null,
  currentRunId: null as string | null,
  workflowChatDeployment: null as CopilotStore['workflowChatDeployment'],
  isLoadingChats: false,
  isSendingMessage: false,
  isAwaitingContinuation: false,
  isAborting: false,
  abortController: null as AbortController | null,
  planTodos: [] as CopilotStore['planTodos'],
  toolCallsById: {} as CopilotStore['toolCallsById'],
  lastNativeOutcome: null,
  error: null,
  historyRefreshError: null,
  isRefreshingHistory: false,
}

function createCopilotStoreInstance(channelId: string) {
  let epoch = 0
  let threadsGeneration = 0
  let interactionGeneration = 0
  let titleEditGeneration = 0
  let titleCandidate: {
    epoch: number
    interaction: number
    workspaceId: string | null
    model: string
    originalInput: string
    titleEdit: number
    threadId?: string
  } | null = null
  let titleAbort: AbortController | null = null
  let turnProvenance: CopilotToolExecutionProvenance = {}
  const inFlightTools = new Set<string>()
  const attemptedTools = new Set<string>()
  let toolQueue: Promise<void> = Promise.resolve()
  let deploymentPromise: {
    id: string
    settled: boolean
    resolve: () => void
    reject: (error: Error) => void
    removeAbort: () => void
  } | null = null
  const store = create<CopilotStore>()(
    devtools((set, get) => {
      const fail = (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Native Copilot request failed'
        const outcome = error instanceof NativeCommandError ? error.nativeOutcome : undefined
        set({ error: message, ...(outcome ? { lastNativeOutcome: outcome } : {}) })
        return message
      }
      const updateTool = (id: string, state: ClientToolCallState, result?: unknown) => {
        const current = get().toolCallsById[id]
        if (!current) return
        const updated = {
          ...current,
          state,
          display: resolveToolDisplay(current.name, state, id, current.params),
          ...(result !== undefined ? { result } : {}),
        }
        set((currentState) => ({
          toolCallsById: { ...currentState.toolCallsById, [id]: updated },
          messages: currentState.messages.map((message) => ({
            ...message,
            contentBlocks: message.contentBlocks?.map((block) =>
              block.type === 'tool_call' && block.toolCall.id === id
                ? { ...block, toolCall: updated }
                : block
            ),
          })),
        }))
      }
      const publishInitialTitle = () => {
        const candidate = titleCandidate
        const chat = get().currentChat
        const outcome = get().lastNativeOutcome
        if (
          !candidate ||
          candidate.epoch !== epoch ||
          candidate.interaction !== interactionGeneration ||
          get().selectedModel !== candidate.model ||
          !chat ||
          chat.workspaceId !== candidate.workspaceId ||
          chat.title !== '' ||
          candidate.titleEdit !== titleEditGeneration ||
          (candidate.threadId !== undefined && candidate.threadId !== chat.threadId) ||
          !outcome ||
          !['completed', 'suspended'].includes(outcome.status) ||
          !('threadId' in outcome) ||
          outcome.threadId !== chat.threadId
        )
          return
        titleCandidate = null // An optional title attempt never retries paid utility work.
        const abort = new AbortController()
        titleAbort = abort
        const current = () =>
          !abort.signal.aborted &&
          candidate.epoch === epoch &&
          candidate.interaction === interactionGeneration &&
          get().currentChat?.threadId === chat.threadId &&
          get().currentChat?.workspaceId === chat.workspaceId &&
          get().selectedModel === candidate.model &&
          get().currentChat?.title === '' &&
          candidate.titleEdit === titleEditGeneration
        const request = {
          workspaceId: chat.workspaceId,
          threadId: chat.threadId,
          model: candidate.model,
          originalInput: candidate.originalInput,
        }
        void (async () => {
          try {
            if (!current()) return
            const response = await fetch('/api/copilot/title', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request),
              signal: abort.signal,
              credentials: 'include',
            })
            const body: unknown = await response.json()
            if (
              !body ||
              typeof body !== 'object' ||
              !('title' in body) ||
              !(body.title === null || typeof body.title === 'string')
            )
              throw new Error('Native initial title response is invalid')
            if (!response.ok || typeof body.title !== 'string' || !body.title || !current()) return
            const updated = await readNativeCommand(
              {
                command: 'thread.title',
                workspaceId: chat.workspaceId,
                threadId: chat.threadId,
                title: body.title,
              },
              abort.signal
            )
            if (
              updated.status !== 'updated' ||
              updated.operation !== 'thread.title' ||
              updated.threadId !== chat.threadId
            )
              throw new Error('Native title publication was not verified')
            if (!current()) return
            const threads = await listNativeThreads(chat.workspaceId, abort.signal)
            const actual = threads.find((thread) => thread.id === chat.threadId)
            if (!actual) throw new Error('Native title readback is unavailable')
            if (!current()) return
            set((state) => ({
              currentChat: state.currentChat ? { ...state.currentChat, title: actual.title } : null,
              chats: state.chats.map((item) =>
                item.threadId === chat.threadId ? { ...item, title: actual.title } : item
              ),
            }))
          } catch (error) {
            if (
              candidate.epoch === epoch &&
              get().currentChat?.threadId === chat.threadId &&
              !abort.signal.aborted
            )
              fail(error)
          } finally {
            if (titleAbort === abort) titleAbort = null
          }
        })()
      }
      const assistantForCommand = () => {
        const last = get().messages.at(-1)
        if (last?.role === 'assistant') return last.id
        const message = createStreamingMessage()
        set((state) => ({ messages: [...state.messages, message] }))
        return message.id
      }
      const verifyPending = (pending: Pending) => {
        if (!get().currentChat || pending.target.threadId !== get().currentChat!.threadId)
          throw new Error('Copilot pending tool is outside the selected thread')
      }
      const ownsChat = (chat: CopilotChat, selectedEpoch: number, interaction: number) =>
        selectedEpoch === epoch &&
        interaction === interactionGeneration &&
        get().currentChat?.threadId === chat.threadId &&
        get().currentChat?.workspaceId === chat.workspaceId
      const refreshChatHistory = async (chat: CopilotChat, current: () => boolean) => {
        const history = await listNativeHistory(chat.workspaceId, chat.threadId)
        if (!current()) return
        const messages = projectNativeHistory(history.items)
        const pending = history.pending
        const currentRunId = pending[0]?.target.runId ?? null
        if (pending.some((item) => item.target.runId !== currentRunId))
          throw new Error('Copilot pending tools belong to different runs')
        const toolCallsById = Object.fromEntries(
          messages.flatMap((message) =>
            (message.contentBlocks ?? []).flatMap((block) =>
              block.type === 'tool_call' ? [[block.toolCall.id, block.toolCall]] : []
            )
          )
        )
        let projected = { ...get(), messages, toolCallsById }
        for (const item of pending) {
          verifyPending(item)
          const live = get().toolCallsById[item.target.toolCallId]
          const provenance =
            live?.pending?.target.runId === item.target.runId ? live.provenance : undefined
          if (toolCallsById[item.target.toolCallId])
            toolCallsById[item.target.toolCallId].provenance = provenance
          projected = { ...projected, ...displayNativePending(projected, item, provenance) }
        }
        if (!current()) return
        set({
          messages: projected.messages,
          toolCallsById: projected.toolCallsById,
          planTodos: buildPlanTodosFromMessages(projected.messages),
          isAwaitingContinuation: pending.length > 0,
          currentRunId,
        })
      }
      const scheduleBrowserTools = () => {
        const id = epoch
        const interaction = interactionGeneration
        for (const call of Object.values(get().toolCallsById)) {
          const pending = call.pending
          if (!pending || !automaticEligible(pending)) continue
          const selected = structuredClone(pending)
          queueMicrotask(() => {
            if (
              id === epoch &&
              interaction === interactionGeneration &&
              automaticEligible(selected)
            )
              void performToolAction(selected.target.toolCallId, {
                kind: 'automatic',
                pending: selected,
              })
          })
        }
      }
      const invoke = async (command: CopilotRequest, messageId = assistantForCommand()) => {
        const id = epoch
        const interaction = interactionGeneration
        const provenance = turnProvenance
        const current = () => id === epoch && interaction === interactionGeneration
        const abort = new AbortController()
        get().abortController?.abort()
        set({
          abortController: abort,
          isSendingMessage: true,
          error: null,
          historyRefreshError: null,
          isRefreshingHistory: false,
        })
        try {
          const response = await postNativeCommand(command, abort.signal)
          if (!current()) return false
          if (!response.ok) await readNativeCommandResponse(response)
          if (
            !response.headers.get('content-type')?.includes('text/event-stream') ||
            !response.body
          )
            throw new Error('Copilot stream is unavailable')
          {
            let terminal = false
            for await (const event of readNativeEvents<CopilotEvent>(response.body, {
              signal: abort.signal,
            })) {
              if (!current() || abort.signal.aborted) return false
              if (terminal)
                throw new Error('Native Copilot emitted data after its terminal outcome')
              set((state) => applyNativeEvent(state, event, messageId, provenance))
              if (
                event.type === 'tool.result' &&
                !event.isError &&
                !event.denied &&
                !isServerToolReviewRejectedResult(event.toolName, event.result)
              )
                await handleCopilotServerToolSuccess(event.toolName, event.result)
              if (
                [
                  'response.completed',
                  'response.suspended',
                  'response.refused',
                  'response.error',
                  'response.cancel_requested',
                ].includes(event.type)
              ) {
                terminal = true
              }
            }
            if (!terminal) throw new Error('Native Copilot ended without a terminal outcome')
          }
          if (
            get().lastNativeOutcome?.status === 'failed' ||
            get().lastNativeOutcome?.status === 'refused' ||
            get().lastNativeOutcome?.status === 'cancel_requested'
          )
            return false
          publishInitialTitle()
          if (
            ['completed', 'suspended'].includes(get().lastNativeOutcome?.status ?? '') &&
            get().currentChat
          ) {
            const chat = get().currentChat!
            try {
              await refreshChatHistory(chat, current)
            } catch (error) {
              if (current() && !abort.signal.aborted)
                set({
                  historyRefreshError:
                    error instanceof Error ? error.message : 'History refresh failed',
                })
            }
          }
          if (!current()) return true
          if (get().isAwaitingContinuation) scheduleBrowserTools()
          return true
        } catch (error) {
          if (current() && !abort.signal.aborted) {
            const message = fail(error)
            set((state) => settleDisplayOnlyTools(state, messageId, ClientToolCallState.error))
            set((state) => ({
              isSendingMessage: false,
              isAwaitingContinuation: false,
              messages: state.messages.map((item) =>
                item.id === messageId
                  ? { ...replaceNativeText(item, item.content || message), isError: true }
                  : item
              ),
            }))
          }
          return false
        } finally {
          if (current() && get().abortController === abort)
            set({ isSendingMessage: false, abortController: null })
        }
      }
      const requestForPending = (pending: Pending) => ({
        workspaceId: get().currentChat!.workspaceId,
        target: pending.target,
      })
      type ToolIntent = {
        kind: 'initial' | 'automatic' | 'accept' | 'reject' | 'decline'
        pending: Pending
      }
      const sameOrigin = (left: Pending | undefined, right: Pending) =>
        !!left &&
        (['target', 'originalArgs'] as const).every(
          (field) =>
            stableStringifyJsonValue(left[field]) === stableStringifyJsonValue(right[field])
        )
      const automaticEligible = (pending: Pending, ownsFlight = false) => {
        const call = get().toolCallsById[pending.target.toolCallId]
        return (
          pending.stage === 'result' &&
          !isServerManagedCopilotTool(pending.target.toolName) &&
          !!call &&
          !call.historical &&
          !call.historyOrigin &&
          call.state === ClientToolCallState.pending &&
          call.result === undefined &&
          sameOrigin(call.pending, pending) &&
          call.pending?.stage === 'result' &&
          (ownsFlight || !inFlightTools.has(pending.target.toolCallId)) &&
          !attemptedTools.has(stableStringifyJsonValue(pending.target)) &&
          !shouldRequireToolApproval(get().accessLevel, isGatedTool(pending.target.toolName))
        )
      }
      const performToolAction = async (id: string, intent: ToolIntent) => {
        if (inFlightTools.has(id)) {
          if (['reject', 'decline'].includes(intent.kind))
            throw new Error('A decision or execution for this tool is already in flight')
          return
        }
        if (intent.kind === 'automatic' && !automaticEligible(intent.pending)) return
        inFlightTools.add(id)
        const chat = get().currentChat
        const generation = epoch
        const interaction = interactionGeneration
        const current = () => !!chat && ownsChat(chat, generation, interaction)
        const previous = toolQueue
        let release!: () => void
        toolQueue = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        let ownedAbort: AbortController | undefined
        try {
          if (!current()) return
          let pending = await get().readPendingTool(id)
          if (!current()) return
          const alreadyApproved =
            intent.kind === 'initial' &&
            intent.pending.stage === 'approval' &&
            pending.stage === 'result'
          if (
            !sameOrigin(pending, intent.pending) ||
            (!alreadyApproved && pending.stage !== intent.pending.stage)
          )
            throw new Error('Original native action changed before dispatch')
          if (intent.kind === 'automatic' && !automaticEligible(pending, true)) return
          if (intent.kind === 'decline') {
            if (pending.stage !== 'approval') throw new Error('Native approval stage changed')
            const declined = await invoke({
              command: 'tool.decline',
              ...requestForPending(pending),
              reason: 'Declined by user',
            })
            if (!current()) return
            if (!declined) throw new Error('Native decline was not verified')
            updateTool(id, ClientToolCallState.rejected)
            return
          }
          if (pending.stage === 'approval') {
            if (intent.kind !== 'initial') throw new Error('Explicit native approval is required')
            const approved = await invoke({
              command: 'tool.approve',
              ...requestForPending(pending),
            })
            if (!current()) return
            if (!approved) throw new Error('Native approval was not verified')
            if (isServerManagedCopilotTool(pending.target.toolName)) return
            const approvedPending = await get().readPendingTool(id)
            if (!current()) return
            if (approvedPending.stage !== 'result' || !sameOrigin(approvedPending, pending))
              throw new Error('Approved native target/arguments/binding changed')
            pending = approvedPending
          }
          if (pending.stage !== 'result') throw new Error('Native result stage is required')
          if (pending.target.toolName === 'oauth_request_access') {
            await get().authorizeToolWorkspace(id)
            if (!current()) return
            if (
              stableStringifyJsonValue(get().toolCallsById[id]?.pending ?? null) !==
              stableStringifyJsonValue(pending)
            )
              throw new Error('Native pending target changed')
          }
          const call = get().toolCallsById[id]
          if (!call || !isCopilotTool(call.name)) throw new Error('Unknown native tool')
          if (call.name === 'gdrive_request_access')
            throw new Error(
              'Choose an authorized workspace and Google Drive credential in this tool card'
            )
          if (isServerManagedCopilotTool(call.name)) {
            const decision = intent.kind === 'accept' || intent.kind === 'reject'
            if (
              decision &&
              (call.state !== ClientToolCallState.review ||
                !isCopilotServerToolReviewResult(call.result))
            )
              throw new Error('The selected business preview changed')
            if (!decision && isCopilotServerToolReviewResult(call.result)) return
            const success = await invoke({
              command: 'tool.execute',
              ...requestForPending(pending),
              action:
                intent.kind === 'reject'
                  ? 'review.reject'
                  : intent.kind === 'accept'
                    ? 'review.accept'
                    : 'execute',
              context: businessContext(call.provenance),
            })
            if (!success) throw new Error('Copilot tool execution did not complete')
          } else {
            if (intent.kind === 'accept' || intent.kind === 'reject')
              throw new Error('This tool does not have a server preview decision')
            const instance = ensureClientToolInstance(call.name, id)
            if (!instance) throw new Error('Native browser tool is unavailable')
            bindClientToolExecutionContext(
              id,
              createExecutionContext({
                toolCallId: id,
                toolName: call.name,
                provenance: call.provenance ?? {},
              })
            )
            const key = stableStringifyJsonValue(pending.target)
            if (attemptedTools.has(key))
              throw new Error(
                'Browser tool execution was already attempted; use readback instead of replay'
              )
            attemptedTools.add(key)
            instance.hydrateToolCall(call)
            if (!isToolId(call.name)) throw new Error('Unknown browser tool')
            const originalArgs = ToolArgSchemas[call.name].parse(pending.originalArgs)
            const businessAbort = new AbortController()
            ownedAbort = businessAbort
            set({ abortController: businessAbort })
            try {
              await instance.handleUserAction(originalArgs)
            } finally {
              if (get().abortController === businessAbort) set({ abortController: null })
            }
          }
        } catch (error) {
          if (current() && sameOrigin(get().toolCallsById[id]?.pending, intent.pending))
            get().recordToolFailure(id, fail(error))
          if (['reject', 'decline'].includes(intent.kind)) throw error
        } finally {
          if (ownedAbort && get().abortController === ownedAbort) set({ abortController: null })
          release()
          inFlightTools.delete(id)
        }
      }
      return {
        ...initialState,
        openWorkflowChatDeployment: async (toolCallId, scope) => {
          if (get().workflowChatDeployment)
            throw new Error('A workflow deployment dialog is already owned by this conversation')
          const chat = get().currentChat
          if (!chat) throw new Error('Native tool thread is missing')
          const generation = epoch
          const interaction = interactionGeneration
          const model = get().selectedModel
          const signal = get().abortController?.signal
          const pending = await get().readPendingTool(toolCallId)
          const args = ToolArgSchemas.deploy_workflow.parse(pending.originalArgs)
          const id = crypto.randomUUID()
          const isCurrent = () => {
            if (!ownsChat(chat, generation, interaction) || get().selectedModel !== model)
              return false
            const dialog = get().workflowChatDeployment
            // Normal native ACK replaces the business signal and consumes Pending.
            // It cannot erase an already observed UI effect or close its settings.
            if (dialog?.id === id && dialog.opened) return true
            return (
              !signal?.aborted &&
              get().toolCallsById[toolCallId]?.name === 'deploy_workflow' &&
              stableStringifyJsonValue(get().toolCallsById[toolCallId]?.pending ?? null) ===
                stableStringifyJsonValue(pending)
            )
          }
          if (!isCurrent()) throw new Error('Native tool selection changed')
          if (
            pending.stage !== 'result' ||
            pending.target.toolName !== 'deploy_workflow' ||
            args.action !== 'deploy' ||
            args.deployType !== 'chat' ||
            args.entityId !== scope.workflowId ||
            typeof scope.workspaceId !== 'string' ||
            !scope.workspaceId.trim() ||
            scope.workspaceId !== scope.workspaceId.trim()
          )
            throw new Error('Original chat deployment target differs')
          const response = await fetch(`/api/workflows/${encodeURIComponent(scope.workflowId)}`, {
            signal,
          })
          if (!isCurrent()) throw new Error('Native tool selection changed')
          if (!response.ok) throw new Error('Workflow target access could not be verified')
          const { data } = await response.json()
          if (!isCurrent()) throw new Error('Native tool selection changed')
          if (data?.id !== scope.workflowId || data.workspaceId !== scope.workspaceId)
            throw new Error('Original workflow workspace differs')
          if (get().workflowChatDeployment)
            throw new Error('A workflow deployment dialog is already owned by this conversation')
          await new Promise<void>((resolve, reject) => {
            const onAbort = () =>
              get().settleWorkflowChatDeployment(
                id,
                'closed',
                'Chat deployment opening was cancelled'
              )
            deploymentPromise = {
              id,
              settled: false,
              resolve,
              reject,
              removeAbort: () => signal?.removeEventListener('abort', onAbort),
            }
            signal?.addEventListener('abort', onAbort, { once: true })
            set({ workflowChatDeployment: { id, toolCallId, ...scope, opened: false, isCurrent } })
            if (!isCurrent()) onAbort()
          })
        },
        settleWorkflowChatDeployment: (id, outcome, message) => {
          const request = get().workflowChatDeployment
          const completion = deploymentPromise
          if (!request || request.id !== id || !completion || completion.id !== id) return
          if (outcome === 'opened' && request.isCurrent()) {
            if (completion.settled) return
            // The real target form committed. Preserve this UI fact before native ACK.
            updateTool(request.toolCallId, ClientToolCallState.executing, {
              opened: true,
              surface: 'chat-deployment',
              message: 'Opened chat deployment settings',
            })
            set({ workflowChatDeployment: { ...request, opened: true } })
            completion.settled = true
            completion.removeAbort()
            completion.resolve()
            return
          }
          completion.removeAbort()
          deploymentPromise = null
          set({ workflowChatDeployment: null })
          if (!completion.settled) {
            completion.settled = true
            completion.reject(
              new Error(message || 'Chat deployment dialog closed before rendering')
            )
          }
        },
        refreshCurrentHistory: async () => {
          const chat = get().currentChat
          if (!chat) return
          const id = epoch
          const interaction = interactionGeneration
          const current = () => ownsChat(chat, id, interaction)
          set({ isRefreshingHistory: true })
          try {
            await refreshChatHistory(chat, current)
            if (current()) set({ historyRefreshError: null })
          } catch (error) {
            if (current())
              set({
                historyRefreshError:
                  error instanceof Error ? error.message : 'History refresh failed',
              })
          } finally {
            if (current()) set({ isRefreshingHistory: false })
          }
        },
        draft: emptyDraft(),
        setAccessLevel: (accessLevel) => set({ accessLevel }),
        setDraft: (update) =>
          set((state) => ({ draft: typeof update === 'function' ? update(state.draft) : update })),
        setPlanTodos: (planTodos) => set({ planTodos }),
        updatePlanTodoStatus: (id, status) =>
          set((state) => ({
            planTodos: state.planTodos.map((todo) =>
              todo.id === id
                ? { ...todo, completed: status === 'completed', executing: status === 'executing' }
                : todo
            ),
          })),
        setSelectedModel: async (selectedModel) => {
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(
              dialog.id,
              'closed',
              'Native model selection changed'
            )
          titleAbort?.abort()
          set({ selectedModel })
        },
        loadChats: async (options) => {
          const workspaceId =
            options?.workspaceId !== undefined ? options.workspaceId : get().conversationWorkspaceId
          const generation = ++threadsGeneration
          const id = epoch
          const interaction = interactionGeneration
          set({
            isLoadingChats: true,
            ...(!get().currentChat && !get().isSendingMessage && !get().isAwaitingContinuation
              ? { conversationWorkspaceId: workspaceId }
              : {}),
          })
          try {
            const threads = await listNativeThreads(workspaceId)
            if (
              generation !== threadsGeneration ||
              id !== epoch ||
              interaction !== interactionGeneration
            )
              return
            const chats: CopilotChat[] = threads.map((thread) => ({
              threadId: thread.id,
              title: thread.title,
              workspaceId,
              createdAt: new Date(thread.createdAt),
              updatedAt: new Date(thread.updatedAt),
            }))
            set({ chats })
            // Opening history must not cancel or erase an active first turn or current selection.
            if (
              get().conversationWorkspaceId === workspaceId &&
              (get().currentChat || get().isSendingMessage || get().isAwaitingContinuation)
            )
              return
            const remembered = getCopilotWorkspaceSelection(workspaceId)
            const selected = chats.find((chat) => chat.threadId === remembered)
            if (selected) await get().selectChat(selected)
            else await get().createNewChat(workspaceId)
          } catch (error) {
            if (
              generation === threadsGeneration &&
              id === epoch &&
              interaction === interactionGeneration
            )
              fail(error)
          } finally {
            if (generation === threadsGeneration) set({ isLoadingChats: false })
          }
        },
        selectChat: async (chat) => {
          get().abortMessage()
          const id = ++epoch
          const interaction = interactionGeneration
          set({
            currentChat: chat,
            conversationWorkspaceId: chat.workspaceId,
            currentRunId: null,
            messages: [],
            toolCallsById: {},
            planTodos: [],
            error: null,
            historyRefreshError: null,
            isRefreshingHistory: false,
            isAwaitingContinuation: false,
            isAborting: false,
          })
          rememberCopilotWorkspaceSelection(chat.workspaceId, chat.threadId)
          const current = () => ownsChat(chat, id, interaction)
          try {
            await refreshChatHistory(chat, current) // History never autoexecutes a tool.
          } catch (error) {
            if (current()) fail(error)
          }
        },
        createNewChat: async (workspaceId) => {
          get().abortMessage()
          ++epoch
          const scope = workspaceId === undefined ? get().conversationWorkspaceId : workspaceId
          rememberCopilotWorkspaceSelection(scope, null)
          set({
            currentChat: null,
            conversationWorkspaceId: scope,
            currentRunId: null,
            messages: [],
            toolCallsById: {},
            planTodos: [],
            draft: emptyDraft(),
            error: null,
            historyRefreshError: null,
            isRefreshingHistory: false,
            isAwaitingContinuation: false,
            isAborting: false,
          })
        },
        deleteChat: async (threadId) => {
          const chat = get().chats.find((item) => item.threadId === threadId)
          if (!chat) throw new Error('Native thread ownership is unavailable')
          const result = await readNativeCommand({
            command: 'thread.delete',
            workspaceId: chat.workspaceId,
            threadId,
          })
          if (
            result.status !== 'updated' ||
            result.operation !== 'thread.delete' ||
            result.threadId !== threadId
          )
            throw new Error('Native thread deletion was not verified')
          set((state) => ({ chats: state.chats.filter((item) => item.threadId !== threadId) }))
          if (get().currentChat?.threadId === threadId) await get().createNewChat(chat.workspaceId)
        },
        sendMessage: async (message, options = {}) => {
          if (
            (!message.trim() && !options.images?.length) ||
            get().isSendingMessage ||
            get().isAwaitingContinuation ||
            get().isAborting ||
            hasUiActiveToolCalls(get().toolCallsById)
          )
            return false
          const model = get().selectedModel
          if (!model) {
            set({ error: 'Select an available Copilot model before sending a message.' })
            return false
          }
          const chat = get().currentChat
          const workspaceId = chat ? chat.workspaceId : get().conversationWorkspaceId
          const id = epoch
          const interaction = ++interactionGeneration
          const titleEdit = titleEditGeneration
          const preflight = new AbortController()
          titleAbort?.abort()
          titleCandidate = null
          set({ isSendingMessage: true, abortController: preflight, error: null })
          const selected = () =>
            id === epoch &&
            interaction === interactionGeneration &&
            get().currentChat?.threadId === chat?.threadId &&
            get().conversationWorkspaceId === workspaceId &&
            get().selectedModel === model &&
            !preflight.signal.aborted
          const contexts = mergeCopilotContexts({
            explicitContexts: options.contexts,
            implicitContexts: options.runtimeContext?.implicitContexts,
          })
          turnProvenance =
            buildTurnProvenanceFromContexts(contexts, options.runtimeContext?.workspaceId) ?? {}
          try {
            const parsed = { content: message, contexts }
            if (!selected()) return false
            let initial = !chat
            if (chat?.title === '' && message.trim()) {
              try {
                initial =
                  (await listNativeHistory(workspaceId, chat.threadId, preflight.signal)).items
                    .length === 0
              } catch {
                initial = false
              }
            }
            if (!selected()) return false
            titleCandidate =
              initial && message.trim() && titleEdit === titleEditGeneration
                ? {
                    epoch,
                    interaction,
                    workspaceId,
                    model,
                    originalInput: message,
                    titleEdit,
                    ...(chat ? { threadId: chat.threadId } : {}),
                  }
                : null
            const user = createUserMessage(message, options.images, contexts)
            const assistant = createStreamingMessage()
            set((state) => ({
              messages: [...state.messages, user, assistant],
              currentRunId: null,
              lastNativeOutcome: null,
            }))
            const success = await invoke(
              {
                command: 'message',
                toolContext: businessContext(turnProvenance),
                toolContexts: collectCopilotToolContexts(contexts),
                workspaceId,
                ...(chat ? { threadId: chat.threadId } : {}),
                model,
                input: {
                  ...parsed,
                  content: options.images?.length
                    ? [{ type: 'text', text: message }, ...options.images]
                    : message,
                },
                accessLevel: get().accessLevel,
              },
              assistant.id
            )
            const completedHere = success && id === epoch && interaction === interactionGeneration
            if (completedHere && options.submittedDraft)
              set((state) =>
                state.draft === options.submittedDraft ? { draft: emptyDraft() } : {}
              )
            return completedHere
          } catch (error) {
            if (id === epoch) fail(error)
            return false
          } finally {
            if (get().abortController === preflight)
              set({ abortController: null, isSendingMessage: false })
          }
        },
        abortMessage: () => {
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(dialog.id, 'closed', 'Native tool selection changed')
          const current = get()
          const cancellationEpoch = ++epoch
          titleAbort?.abort()
          titleCandidate = null
          current.abortController?.abort()
          for (const id of Object.keys(current.toolCallsById)) unregisterClientTool(id)
          set({
            ...settleDisplayOnlyTools(current),
            abortController: null,
            isSendingMessage: false,
            isAborting: Boolean(current.currentChat && current.currentRunId),
            isRefreshingHistory: false,
          })
          if (current.currentChat && current.currentRunId)
            void readNativeCommand({
              command: 'cancel',
              workspaceId: current.currentChat.workspaceId,
              threadId: current.currentChat.threadId,
              runId: current.currentRunId,
            })
              .then((result) => {
                if (
                  cancellationEpoch !== epoch ||
                  get().currentChat?.threadId !== current.currentChat?.threadId
                )
                  return
                if (result.status !== 'cancel_requested' || result.runId !== current.currentRunId)
                  throw new Error('Native cancellation was not verified')
                set((state) => applyNativeCancellation(state, result))
              })
              .catch((error) => {
                if (cancellationEpoch === epoch) {
                  set({ isAborting: false })
                  fail(error)
                }
              })
        },
        reset: () => {
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(dialog.id, 'closed', 'Native tool owner changed')
          ++epoch
          titleAbort?.abort()
          titleCandidate = null
          threadsGeneration++
          get().abortController?.abort()
          inFlightTools.clear()
          attemptedTools.clear()
          set({ ...initialState, draft: emptyDraft() })
        },
        editMessage: async (messageId, text) => {
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(dialog.id, 'closed', 'Native history changed')
          interactionGeneration++
          titleAbort?.abort()
          titleCandidate = null
          const chat = get().currentChat
          if (!chat) throw new Error('Native thread is required for an edit')
          const id = epoch
          const interaction = interactionGeneration
          const current = () => ownsChat(chat, id, interaction)
          const result = await readNativeCommand({
            command: 'history.edit',
            workspaceId: chat.workspaceId,
            threadId: chat.threadId,
            messageId,
            text,
          }).catch((error) => {
            if (current()) throw error
          })
          if (!current() || !result) return
          if (
            result.status !== 'updated' ||
            result.operation !== 'history.edit' ||
            result.threadId !== chat.threadId ||
            result.messageId !== messageId
          )
            throw new Error('Native history edit was not verified')
          await refreshChatHistory(chat, current).catch((error) => {
            if (current()) throw error
          })
        },
        readPendingTool: async (toolCallId) => {
          const call = get().toolCallsById[toolCallId]
          const pending = call?.pending
          if (
            !pending ||
            pending.target.toolCallId !== toolCallId ||
            pending.target.toolName !== call.name
          )
            throw new Error('Copilot tool is no longer pending')
          verifyPending(pending)
          return structuredClone(pending)
        },
        authorizeToolWorkspace: async (id, workspaceId) => {
          const chat = get().currentChat
          if (!chat) throw new Error('Native tool thread is missing')
          const generation = epoch
          const interaction = interactionGeneration
          const pending = await get().readPendingTool(id)
          const current = () =>
            ownsChat(chat, generation, interaction) &&
            stableStringifyJsonValue(get().toolCallsById[id]?.pending ?? null) ===
              stableStringifyJsonValue(pending)
          if (
            !['gdrive_request_access', 'oauth_request_access'].includes(pending.target.toolName) ||
            pending.stage !== 'result'
          )
            throw new Error('Native approval is required before choosing an access workspace')
          const provenance = get().toolCallsById[id]?.provenance
          if (provenance?.workspaceId && workspaceId && workspaceId !== provenance.workspaceId)
            throw new Error('This tool workspace is already pinned')
          const selected = workspaceId ?? provenance?.workspaceId
          if (typeof selected !== 'string' || !selected.trim() || selected !== selected.trim())
            throw new Error('Choose an authorized workspace for this access request')
          const response = await fetch('/api/workspaces')
          if (!current()) throw new Error('Native tool selection changed')
          if (!response.ok) throw new Error('Workspace access could not be verified')
          const { workspaces } = await response.json()
          if (!current()) throw new Error('Native tool selection changed')
          if (
            !Array.isArray(workspaces) ||
            workspaces.some((item) => !item || typeof item.id !== 'string' || !item.id.trim()) ||
            new Set(workspaces.map((item) => item.id)).size !== workspaces.length ||
            workspaces.filter((item) => item.id === selected).length !== 1
          )
            throw new Error('The selected workspace is unavailable or ambiguous')
          set((state) => {
            const call = {
              ...state.toolCallsById[id],
              provenance: { ...provenance, workspaceId: selected },
            }
            return {
              toolCallsById: { ...state.toolCallsById, [id]: call },
              messages: state.messages.map((message) => ({
                ...message,
                contentBlocks: message.contentBlocks?.map((block) =>
                  block.type === 'tool_call' && block.toolCall.id === id
                    ? { ...block, toolCall: call }
                    : block
                ),
              })),
            }
          })
          return selected
        },
        submitBrowserAssertion: async (id, assertion) => {
          const pending = await get().readPendingTool(id)
          if (pending.stage !== 'result')
            throw new Error('Native approval is required before a result')
          const success = await invoke({
            command: 'tool.result',
            ...requestForPending(pending),
            assertion,
          })
          if (!success) throw new Error('Native browser result delivery was not verified')
        },
        readbackCopilotToolCall: async (id, readback) => {
          const chat = get().currentChat
          if (!chat) throw new Error('Native tool thread is missing')
          const generation = epoch
          const interaction = interactionGeneration
          const pending = await get().readPendingTool(id)
          if (pending.stage !== 'result')
            throw new Error('Native approval is required before readback')
          const context = businessContext(get().toolCallsById[id]?.provenance)
          if (
            pending.target.toolName === 'gdrive_request_access' &&
            (!context?.workspaceId || !readback?.credentialId?.trim())
          )
            throw new Error('Choose an authorized workspace and credential for this Drive request')
          const success = await invoke({
            command: 'tool.execute',
            ...requestForPending(pending),
            action: 'readback',
            ...(context ? { context } : {}),
            ...(readback?.credentialId
              ? { readback: { credentialId: readback.credentialId } }
              : {}),
          })
          if (!ownsChat(chat, generation, interaction)) return
          if (!success) throw new Error('Authoritative readback did not complete')
        },
        recordToolFailure: (id, message) => {
          updateTool(
            id,
            ClientToolCallState.error,
            get().toolCallsById[id]?.result === undefined ? { error: message } : undefined
          )
          set({ error: message })
        },
        executeCopilotToolCall: async (id) => {
          const call = get().toolCallsById[id]
          if (!call?.pending) {
            get().recordToolFailure(id, 'A genuine native pending target is required')
            return
          }
          const review =
            call.state === ClientToolCallState.review &&
            isCopilotServerToolReviewResult(call.result)
          await performToolAction(id, {
            kind: review ? 'accept' : 'initial',
            pending: structuredClone(call.pending),
          })
        },
        skipCopilotToolCall: async (id) => {
          const call = get().toolCallsById[id]
          if (!call?.pending) throw new Error('A genuine native pending target is required')
          if (call.pending.stage === 'approval')
            return performToolAction(id, {
              kind: 'decline',
              pending: structuredClone(call.pending),
            })
          if (
            !isServerManagedCopilotTool(call.name) ||
            call.state !== ClientToolCallState.review ||
            !isCopilotServerToolReviewResult(call.result)
          )
            throw new Error(
              'This pending action has no server preview to reject; use Stop to cancel the response'
            )
          await performToolAction(id, {
            kind: 'reject',
            pending: structuredClone(call.pending),
          })
        },
      }
    })
  )
  store.subscribe((state, previous) => {
    if (
      state.currentChat?.threadId === previous.currentChat?.threadId &&
      state.currentChat?.title !== previous.currentChat?.title
    )
      titleEditGeneration++
  })
  return store
}

const copilotStoreRegistry = new Map<string, StoreApi<CopilotStore>>()
let activeAuthenticatedUserId: string | null = null
export function getCopilotStore(channelId: string) {
  if (!copilotStoreRegistry.has(channelId))
    copilotStoreRegistry.set(channelId, createCopilotStoreInstance(channelId))
  return copilotStoreRegistry.get(channelId)!
}
export function resetCopilotStoreRegistry() {
  for (const store of copilotStoreRegistry.values()) store.getState().reset()
  copilotStoreRegistry.clear()
  disposeAllClientTools()
  resetCopilotWorkspaceSelectionState()
  activeAuthenticatedUserId = null
}
function activateAuthenticatedCopilotUser(userId: string) {
  if (activeAuthenticatedUserId === userId) return
  for (const [channel, store] of copilotStoreRegistry)
    if (parseCopilotWorkspaceChannelId(channel)?.authenticatedUserId !== userId) {
      store.getState().reset()
      copilotStoreRegistry.delete(channel)
    }
  disposeClientToolsExcept(
    new Set(
      [...copilotStoreRegistry.values()].flatMap((store) =>
        Object.keys(store.getState().toolCallsById)
      )
    )
  )
  resetCopilotWorkspaceSelectionState()
  activeAuthenticatedUserId = userId
}
registerCopilotStoreForToolCallResolver((id) => {
  const stores = [...copilotStoreRegistry.values()].filter(
    (store) => store.getState().toolCallsById[id]
  )
  if (stores.length !== 1) throw new Error(`No unique active Copilot store owns tool call ${id}`)
  return stores[0]
})
registerToolStateSync((id, state, options) => {
  const owners = [...copilotStoreRegistry.values()].filter(
    (item) => item.getState().toolCallsById[id]
  )
  const store = owners.length === 1 ? owners[0] : undefined
  const call = store?.getState().toolCallsById[id]
  if (!store || !call || !Object.values(ClientToolCallState).includes(state)) return
  const next = {
    ...call,
    state,
    ...(options?.result !== undefined ? { result: options.result } : {}),
  }
  store.setState((current) => ({
    toolCallsById: { ...current.toolCallsById, [id]: next },
    messages: updateMessagesForToolCallState(current.messages, id, state, options),
  }))
})
const CopilotStoreContext = createContext<StoreApi<CopilotStore> | null>(null)
export function CopilotStoreProvider({
  channelId,
  children,
}: {
  channelId: string
  children: ReactNode
}) {
  const identity = useMemo(() => {
    const value = parseCopilotWorkspaceChannelId(channelId)
    if (!value) throw new Error('CopilotStoreProvider requires an authenticated workspace channel')
    return value
  }, [channelId])
  const store = useMemo(() => getCopilotStore(channelId), [channelId])
  useLayoutEffect(() => {
    activateAuthenticatedCopilotUser(identity.authenticatedUserId)
  }, [identity.authenticatedUserId, store])
  return createElement(CopilotStoreContext.Provider, { value: store }, children)
}
const identitySelector = (state: CopilotStore) => state
export function useCopilotStore<T = CopilotStore>(
  selector?: (state: CopilotStore) => T,
  equalityFn?: (a: T, b: T) => boolean
) {
  const store = useContext(CopilotStoreContext)
  if (!store) throw new Error('useCopilotStore requires CopilotStoreProvider')
  return useStoreWithEqualityFn(
    store,
    selector ?? (identitySelector as unknown as (state: CopilotStore) => T),
    equalityFn
  )
}
export function useCopilotStoreApi() {
  const store = useContext(CopilotStoreContext)
  if (!store) throw new Error('useCopilotStoreApi requires CopilotStoreProvider')
  return store
}
