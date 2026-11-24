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
import { BrowserStorage } from '@/lib/browser-storage'
import { shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { mergeCopilotContexts } from '@/lib/copilot/chat-contexts'
import {
  EDIT_REPLAY_BLOCKED_MESSAGE,
  hasToolActivityAfterMessage,
} from '@/lib/copilot/chat-replay-safety'
import type {
  CopilotRequest,
  CopilotThreadEvent,
  HistoryResponse,
  Pending,
  Target,
} from '@/lib/copilot/native/contract'
import { nativeToolCallId } from '@/lib/copilot/native/identity'
import { serializeCopilotRequest } from '@/lib/copilot/native/request-size'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  disposeAllClientTools,
  disposeClientToolsExcept,
  getClientTool,
  unregisterClientTool,
} from '@/lib/copilot/tools/client/manager'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { isCopilotServerToolReviewResult } from '@/lib/copilot/tools/client/server-tool-response'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { workflowReadback } from '@/lib/copilot/tools/client/workflow/workflow-result'
import { readSseData, waitToReconnect } from '@/lib/events/stream'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { reasoningSchema } from '@/lib/mastra/reasoning'
import {
  cancelQueuedWorkflowExecution,
  observeQueuedWorkflowExecution,
  type QueuedWorkflowExecutionHandle,
  WorkflowQueueAdmissionError,
} from '@/lib/workflows/queued-execution-client'
import { getQueryClient } from '@/app/query-provider'
import { organizationKeys } from '@/hooks/queries/organization'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { parseCopilotWorkspaceChannelId } from './channel-id'
import { projectNativeHistory } from './history'
import {
  listNativeThreads,
  postNativeCommand,
  readNativeCommand,
  readNativeCommandResponse,
} from './native-api'
import { registerCopilotStoreForToolCallResolver } from './store-access'
import {
  createStreamingMessage,
  createUserMessage,
  updateMessageToolCalls,
  updateToolCallState,
} from './store-messages'
import { buildTurnProvenanceFromContexts } from './store-provenance'
import { isCopilotBusy } from './store-state'
import {
  applyNativeCancellation,
  applyNativeEvent,
  displayNativePending,
  replaceNativeText,
  samePendingOrigin,
  settleDisplayOnlyTools,
} from './streaming'
import {
  ensureClientToolInstance,
  handleCopilotServerToolSuccess,
  isGatedTool,
  isServerManagedCopilotTool,
} from './tool-registry'
import type { CopilotChat, CopilotDraft, CopilotStore, CopilotToolCall } from './types'
import {
  getCopilotWorkspaceSelection,
  rememberCopilotWorkspaceSelection,
  resetCopilotWorkspaceSelectionState,
} from './workspace-selection'

const emptyDraft = (): CopilotDraft => ({ text: '', contexts: [] })
const refreshBillingUsage = () => {
  const queryClient = getQueryClient()
  void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
  void queryClient.invalidateQueries({ queryKey: organizationKeys.all })
}
async function requireCopilotStream(response: Response) {
  if (!response.ok) await readNativeCommandResponse(response)
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('Copilot stream is unavailable')
  return response.body
}
const initialState = {
  accessLevel: 'limited' as const,
  selectedModel: null as string | null,
  reasoning: undefined as CopilotStore['reasoning'],
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
  toolCallsById: {} as CopilotStore['toolCallsById'],
  error: null,
}

function createCopilotStoreInstance(channelId: string) {
  const preferenceKey = parseCopilotWorkspaceChannelId(channelId)
    ? `copilot-model:${channelId}`
    : undefined
  const readPreference = () => {
    if (!preferenceKey) return {}
    const saved = BrowserStorage.getItem<{ selectedModel?: unknown; reasoning?: unknown } | null>(
      preferenceKey,
      null
    )
    return typeof saved?.selectedModel === 'string'
      ? {
          selectedModel: saved.selectedModel,
          reasoning: reasoningSchema.safeParse(saved.reasoning).data,
        }
      : {}
  }
  let epoch = 0
  let owner = new AbortController()
  let threadsGeneration = 0
  let titleCandidate: {
    epoch: number
    workspaceId: string | null
    model: string
    originalInput: string
    threadId?: string
  } | null = null
  let titleAbort: AbortController | null = null
  let workflow:
    | {
        workspaceId: string | null
        target: Target
        admission: Promise<QueuedWorkflowExecutionHandle>
        stopping: boolean
      }
    | undefined
  const trackWorkflow = (
    workspaceId: string | null,
    target: Target,
    admission: Promise<QueuedWorkflowExecutionHandle>
  ) => {
    const entry = { workspaceId, target, admission, stopping: false }
    workflow = entry
    const completed = () => {
      if (workflow === entry && !entry.stopping) workflow = undefined
    }
    void admission.catch((error) => {
      if (error instanceof WorkflowQueueAdmissionError) completed()
    })
    return completed
  }
  let observation: AbortController | null = null
  let admission: ReturnType<typeof readNativeCommandResponse> | undefined
  const inFlightTools = new Set<string>()
  const attemptedTools = new Set<string>()
  const refreshedTools = new Set<string>()
  const refreshToolResult = (call: CopilotToolCall) => {
    if (
      call.state === ClientToolCallState.success &&
      !call.pending &&
      !refreshedTools.has(call.id)
    ) {
      refreshedTools.add(call.id)
      return handleCopilotServerToolSuccess(call.name, call.result)
    }
  }
  let toolQueue: Promise<void> = Promise.resolve()
  let deploymentPromise: {
    id: string
    settled: boolean
    resolve: () => void
    reject: (error: Error) => void
    removeAbort: () => void
  } | null = null
  return create<CopilotStore>()(
    devtools((set, get) => {
      const fail = (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Native Copilot request failed'
        set({ error: message })
        return message
      }
      const updateTool = (id: string, state: ClientToolCallState, result?: unknown) =>
        set((current) => updateToolCallState(current, id, state, result))
      const publishInitialTitle = () => {
        const candidate = titleCandidate
        const chat = get().currentChat
        if (!candidate || !chat) return
        titleCandidate = null // An optional title attempt never retries paid utility work.
        const abort = new AbortController()
        titleAbort = abort
        const current = () =>
          !abort.signal.aborted &&
          candidate.epoch === epoch &&
          candidate.workspaceId === chat.workspaceId &&
          (candidate.threadId === undefined || candidate.threadId === chat.threadId) &&
          get().currentChat?.threadId === chat.threadId &&
          get().currentChat?.workspaceId === chat.workspaceId &&
          get().selectedModel === candidate.model &&
          get().currentChat?.title === ''
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
            const title = body.title
            if (!response.ok || typeof title !== 'string' || !title || !current()) return
            const updated = await readNativeCommand(
              {
                command: 'thread.title',
                workspaceId: chat.workspaceId,
                threadId: chat.threadId,
                title,
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
            set((state) => ({
              currentChat: state.currentChat ? { ...state.currentChat, title } : null,
              chats: state.chats.map((item) =>
                item.threadId === chat.threadId ? { ...item, title } : item
              ),
            }))
          } catch (error) {
            if (current()) fail(error)
          } finally {
            if (titleAbort === abort) titleAbort = null
            refreshBillingUsage()
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
      const ownsChat = (chat: CopilotChat, selectedEpoch: number) =>
        selectedEpoch === epoch &&
        get().currentChat?.threadId === chat.threadId &&
        get().currentChat?.workspaceId === chat.workspaceId
      const applyHistory = (
        history: HistoryResponse,
        activeRunId: string | null = null,
        submittedRunId?: string
      ) => {
        if (history.threadId !== get().currentChat?.threadId)
          throw new Error('Observed Copilot history belongs to another conversation')
        const messages = projectNativeHistory(history.items)
        const pending = history.pending
        const currentRunId = activeRunId ?? pending[0]?.target.runId ?? null
        if (pending.some((item) => item.target.runId !== currentRunId))
          throw new Error('Copilot pending tools belong to different runs')
        const toolCallsById = Object.fromEntries(
          messages.flatMap((message) =>
            (message.contentBlocks ?? []).flatMap((block) =>
              block.type === 'tool_call' ? [[block.toolCall.id, block.toolCall]] : []
            )
          )
        )
        if (workflow) {
          const id = nativeToolCallId(workflow.target)
          const card = toolCallsById[id]
          if (
            (currentRunId && workflow.target.runId !== currentRunId) ||
            (!workflow.stopping &&
              card &&
              workflowReadback(card.name, card.result)?.executionId === id)
          )
            workflow = undefined
        }
        let projected = { ...get(), messages, toolCallsById }
        for (const item of pending) {
          const id = nativeToolCallId(item.target)
          const live = get().toolCallsById[id]
          const matchingLive =
            samePendingOrigin(live?.pending, item) ||
            (submittedRunId === item.target.runId &&
              live &&
              !live.pending &&
              !live.historical &&
              !live.historyOrigin &&
              live.name === item.target.toolName)
              ? live
              : undefined
          const projectedCall = (projected.toolCallsById[id] = matchingLive ??
            projected.toolCallsById[id] ?? {
              id,
              name: item.target.toolName,
              historical: true,
              state: ClientToolCallState.aborted,
            })
          if (!live && submittedRunId === item.target.runId) {
            projectedCall.historical = false
            projectedCall.state = ClientToolCallState.pending
          }
          projected = { ...projected, ...displayNativePending(projected, item) }
        }
        for (const id of Object.keys(get().toolCallsById))
          if (!projected.toolCallsById[id]) unregisterClientTool(id)
        set({
          messages: projected.messages,
          toolCallsById: projected.toolCallsById,
          isAwaitingContinuation: pending.length > 0,
          isSendingMessage: !!activeRunId && pending.length === 0,
          currentRunId,
        })
        for (const call of Object.values(projected.toolCallsById)) void refreshToolResult(call)
      }
      const observeChat = async (
        chat: CopilotChat,
        submittedRunId?: string,
        onReady?: () => void,
        submitted?: CopilotRequest
      ): Promise<boolean> => {
        observation?.abort()
        const abort = new AbortController()
        observation = abort
        const id = epoch
        const current = () => ownsChat(chat, id) && !abort.signal.aborted
        const ready = () => {
          onReady?.()
          onReady = undefined
        }
        const submittedReadback =
          submitted?.command === 'tool.execute' &&
          submitted.action === 'readback' &&
          submitted.target.toolName === 'run_workflow'
            ? submitted
            : undefined
        const staleReadback = () => {
          set({
            isSendingMessage: false,
            error: 'The workflow readback no longer matches the pending tool.',
          })
          return false
        }
        const followWorkflow = async (history: HistoryResponse): Promise<boolean> => {
          const instruction = history.workflowObservation!
          const { handle, target } = instruction
          const call = get().toolCallsById[nativeToolCallId(target)]
          if (
            history.readbackRequestId !== instruction.requestId ||
            (submitted &&
              (submittedReadback?.requestId !== instruction.requestId ||
                stableStringifyJsonValue(submittedReadback.target) !==
                  stableStringifyJsonValue(target))) ||
            call?.pending?.stage !== 'result' ||
            target.toolName !== 'run_workflow' ||
            stableStringifyJsonValue(call.pending.target) !== stableStringifyJsonValue(target) ||
            call.pending.originalArgs.entityId !== handle.workflowId ||
            handle.executionId !== nativeToolCallId(target) ||
            handle.taskId !== handle.executionId
          )
            return staleReadback()
          const completed = trackWorkflow(chat.workspaceId, target, Promise.resolve(handle))
          set({ isSendingMessage: true })
          updateTool(call.id, ClientToolCallState.executing)
          try {
            await observeQueuedWorkflowExecution(handle, { signal: abort.signal })
            completed()
            if (!current() || get().isAborting) return false
            return await invoke({
              command: 'tool.execute',
              action: 'readback',
              requestId: instruction.nextRequestId,
              workspaceId: chat.workspaceId,
              target,
            })
          } catch (error) {
            if (current()) {
              fail(error)
              updateTool(call.id, ClientToolCallState.error)
              set({ isSendingMessage: false })
            }
            return false
          }
        }
        let messageId: string | undefined
        try {
          while (current()) {
            let retryable = true
            try {
              const response = await postNativeCommand(
                serializeCopilotRequest({
                  command: 'thread.observe',
                  workspaceId: chat.workspaceId,
                  threadId: chat.threadId,
                }),
                abort.signal
              )
              if (!current()) return false
              if (!response.ok) {
                retryable =
                  response.status !== 501 &&
                  (response.status >= 500 || [408, 429].includes(response.status))
              }
              const stream = await requireCopilotStream(response)
              for await (const data of readSseData(stream, {
                signal: abort.signal,
              })) {
                const event = JSON.parse(data) as CopilotThreadEvent
                if (!current()) return false
                if (event.type === 'thread.history') {
                  applyHistory(event.result, event.activeRunId, submittedRunId)
                  messageId = undefined
                  if (event.error) set({ error: event.error.message })
                  // History refresh does not clear a request failure.
                  if (event.interruptedRunId && !get().error)
                    set({
                      error:
                        'The previous response was interrupted. You can continue this conversation.',
                    })
                  if (event.interruptedRunId && submittedRunId === event.interruptedRunId)
                    return false
                  ready()
                  if (!event.activeRunId && event.result.workflowObservation)
                    return await followWorkflow(event.result)
                  continue
                }
                if (event.type === 'thread.status') {
                  if (
                    submittedReadback &&
                    (submittedRunId !== event.runId ||
                      event.history.readbackRequestId !== submittedReadback.requestId)
                  )
                    return staleReadback()
                  applyHistory(event.history, null, submittedRunId)
                  if (event.status === 'suspended' && event.history.workflowObservation)
                    return await followWorkflow(event.history)
                  set({
                    isAborting: false,
                    error:
                      event.error?.message ??
                      get().error ??
                      (['failed', 'aborted'].includes(event.status)
                        ? 'This response was interrupted. Saved history and usage have been preserved.'
                        : null),
                  })
                  refreshBillingUsage()
                  if (submittedRunId) {
                    if (submittedReadback && ['success', 'suspended'].includes(event.status)) {
                      const card = get().toolCallsById[nativeToolCallId(submittedReadback.target)]
                      if (
                        !card ||
                        card.pending ||
                        workflowReadback(card.name, card.result)?.executionId !== card.id
                      )
                        return staleReadback()
                    }
                    if (event.status === 'suspended' && event.runId === submittedRunId)
                      scheduleBrowserTools()
                    return ['success', 'suspended'].includes(event.status)
                  }
                  messageId = undefined
                  continue
                }
                if (event.type === 'thread.started') {
                  messageId = event.messageId
                  const assistant = get().messages.find((item) => item.id === messageId)
                  if (assistant && assistant.role !== 'assistant')
                    throw new Error('Native assistant identity belongs to another message role')
                  set((state) => ({
                    currentRunId: event.runId,
                    isSendingMessage: true,
                    isAwaitingContinuation: false,
                    error: null,
                    messages: assistant
                      ? state.messages
                      : [...state.messages, createStreamingMessage(messageId)],
                  }))
                  continue
                }
                if (event.runId !== get().currentRunId) continue
                if (!messageId) {
                  retryable = false
                  throw new Error('Response identity is unavailable. Reload to view saved history.')
                }
                set((state) => applyNativeEvent(state, event.event, messageId!))
                if (event.event.type === 'tool.result')
                  await refreshToolResult(
                    get().toolCallsById[
                      nativeToolCallId({ runId: event.runId, toolCallId: event.event.toolCallId })
                    ]
                  )
              }
            } catch (error) {
              if (!current()) return false
              if (!retryable) {
                fail(error)
                set({
                  isSendingMessage: false,
                  isAwaitingContinuation: Boolean(get().currentRunId),
                })
                return false
              }
            }
            await waitToReconnect(abort.signal)
          }
          return false
        } finally {
          ready()
          if (observation === abort) observation = null
          refreshBillingUsage()
        }
      }
      const restoreChat = (chat: CopilotChat) =>
        new Promise<void>((resolve) => {
          void observeChat(chat, undefined, resolve)
        })
      const scheduleBrowserTools = () => {
        const id = epoch
        for (const call of Object.values(get().toolCallsById)) {
          const pending = call.pending
          if (!pending || !automaticEligible(pending)) continue
          const selected = structuredClone(pending)
          queueMicrotask(() => {
            if (id === epoch && automaticEligible(selected))
              void performToolAction(call.id, {
                kind: 'automatic',
                pending: selected,
              })
          })
        }
      }
      const invoke = async (
        command: CopilotRequest,
        messageId = assistantForCommand(),
        body = serializeCopilotRequest(command),
        onAccepted?: () => void
      ): Promise<boolean> => {
        observation?.abort()
        const id = epoch
        const ownerSignal = owner.signal
        const abort = new AbortController()
        const current = () => id === epoch && !abort.signal.aborted
        get().abortController?.abort()
        set({ abortController: abort, isSendingMessage: true, error: null })
        let accepting: typeof admission
        try {
          // Keep admission alive so Stop can cancel the durable run it returns.
          admission = accepting = (async (): ReturnType<typeof readNativeCommandResponse> => {
            for (;;) {
              try {
                const result = await postNativeCommand(body, ownerSignal).then(
                  readNativeCommandResponse
                )
                ownerSignal.throwIfAborted()
                return result
              } catch (error) {
                if (!(error instanceof TypeError || error instanceof SyntaxError)) throw error
                await waitToReconnect(ownerSignal)
              }
            }
          })()
          const result = await accepting
          if (admission === accepting) admission = undefined
          if (id !== epoch) return false
          if (result.status !== 'accepted') throw new Error('Copilot command was not accepted')
          const selected = get().currentChat
          if (selected && selected.threadId !== result.threadId)
            throw new Error('Native response thread differs')
          if (get().currentRunId && get().currentRunId !== result.runId)
            throw new Error('Native response run differs')
          const chat: CopilotChat = {
            ...(selected ?? {
              threadId: result.threadId,
              workspaceId: command.workspaceId,
              title: '',
              createdAt: new Date(),
            }),
            updatedAt: new Date(),
          }
          set((state) => {
            let messages = state.messages
            if (command.command === 'message') {
              if (!result.messageId) throw new Error('Native input message identity is unavailable')
              const index = command.messageId
                ? messages.findIndex((message) => message.id === command.messageId)
                : messages.findIndex((message) => message.id === messageId) - 1
              if (index < 0 || messages[index]?.role !== 'user')
                throw new Error('Native response input message is unavailable')
              if (command.messageId && typeof command.input.content !== 'string')
                throw new Error('Edited Copilot input must be text')
              const input = command.messageId
                ? createUserMessage(
                    command.input.content as string,
                    undefined,
                    command.input.contexts,
                    result.messageId
                  )
                : { ...messages[index], id: result.messageId }
              messages = [...messages.slice(0, index), input]
            }
            return {
              messages,
              currentChat: chat,
              currentRunId: result.runId,
              chats: state.chats.some((item) => item.threadId === chat.threadId)
                ? state.chats.map((item) => (item.threadId === chat.threadId ? chat : item))
                : [chat, ...state.chats],
            }
          })
          rememberCopilotWorkspaceSelection(channelId, command.workspaceId, result.threadId)
          onAccepted?.()
          if (!current() || get().isAborting) return false
          const success = await observeChat(chat, result.runId, undefined, command)
          if (success && current()) publishInitialTitle()
          return success && ownsChat(chat, id)
        } catch (error) {
          if (id === epoch) {
            const message = fail(error)
            set((state) => settleDisplayOnlyTools(state, messageId, ClientToolCallState.error))
            set((state) => ({
              isSendingMessage: false,
              messages: state.messages.map((item) =>
                item.id === messageId
                  ? { ...replaceNativeText(item, item.content || message), isError: true }
                  : item
              ),
            }))
          }
          return false
        } finally {
          if (admission === accepting) admission = undefined
          if (get().abortController === abort) set({ abortController: null })
          refreshBillingUsage()
        }
      }
      const requestForPending = (pending: Pending) => ({
        requestId: crypto.randomUUID(),
        workspaceId: get().currentChat!.workspaceId,
        target: pending.target,
      })
      type ToolIntent = {
        kind: 'initial' | 'automatic' | 'accept' | 'reject' | 'decline'
        pending: Pending
      }
      const automaticEligible = (pending: Pending, ownsFlight = false) => {
        const id = nativeToolCallId(pending.target)
        const call = get().toolCallsById[id]
        return (
          pending.stage === 'result' &&
          pending.target.toolName !== 'oauth_request_access' &&
          !isServerManagedCopilotTool(pending.target.toolName) &&
          !!call &&
          !call.historical &&
          !call.historyOrigin &&
          call.state === ClientToolCallState.pending &&
          call.result === undefined &&
          samePendingOrigin(call.pending, pending) &&
          call.pending?.stage === 'result' &&
          (ownsFlight || !inFlightTools.has(id)) &&
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
        let closeOAuthWindow: (() => void) | undefined
        if (
          intent.kind === 'initial' &&
          intent.pending.stage === 'result' &&
          intent.pending.target.toolName === 'oauth_request_access'
        ) {
          const instance = ensureClientToolInstance('oauth_request_access', id)
          if (instance instanceof OAuthRequestAccessClientTool) {
            closeOAuthWindow = instance.prepareWindow()
            if (!closeOAuthWindow) return
          }
        }
        inFlightTools.add(id)
        const chat = get().currentChat
        const generation = epoch
        const current = () => !!chat && ownsChat(chat, generation)
        const previous = toolQueue
        let release!: () => void
        toolQueue = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        try {
          if (!current()) return
          let pending = await get().readPendingTool(id)
          if (!current()) return
          const alreadyApproved =
            intent.kind === 'initial' &&
            intent.pending.stage === 'approval' &&
            pending.stage === 'result'
          if (
            !samePendingOrigin(pending, intent.pending) ||
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
            if (
              isServerManagedCopilotTool(pending.target.toolName) ||
              pending.target.toolName === 'oauth_request_access'
            )
              return
            const approvedPending = await get().readPendingTool(id)
            if (!current()) return
            if (approvedPending.stage !== 'result' || !samePendingOrigin(approvedPending, pending))
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
          if (!call || !isToolId(call.name)) throw new Error('Unknown native tool')
          if (call.name === 'gdrive_request_access')
            throw new Error(
              'Choose an authorized workspace and Google Drive credential in this tool card'
            )
          if (isServerManagedCopilotTool(call.name)) {
            const decision = intent.kind === 'accept' || intent.kind === 'reject'
            if (!decision) return
            if (
              call.state !== ClientToolCallState.review ||
              !isCopilotServerToolReviewResult(call.result)
            )
              throw new Error('The selected business preview changed')
            const success = await invoke({
              command: 'tool.execute',
              ...requestForPending(pending),
              action: intent.kind === 'reject' ? 'review.reject' : 'review.accept',
              context: call.provenance,
            })
            if (!success) throw new Error('Copilot tool execution did not complete')
          } else {
            if (intent.kind === 'accept' || intent.kind === 'reject')
              throw new Error('This tool does not have a server preview decision')
            const instance = ensureClientToolInstance(call.name, id)
            if (!instance) throw new Error('Native browser tool is unavailable')
            const key = stableStringifyJsonValue(pending.target)
            if (
              attemptedTools.has(key) &&
              !(
                intent.kind === 'initial' &&
                call.state === ClientToolCallState.pending &&
                instance instanceof RunWorkflowClientTool &&
                instance.hasAttemptedExecution() === false
              )
            )
              throw new Error(
                'Browser tool execution was already attempted; use readback instead of replay'
              )
            attemptedTools.add(key)
            const originalArgs = ToolArgSchemas[call.name].parse(pending.originalArgs)
            instance.setExecutionContext({
              workspaceId: call.provenance?.workspaceId,
              onWorkflowAdmission:
                call.name === 'run_workflow'
                  ? (admission) => trackWorkflow(chat!.workspaceId, pending.target, admission)
                  : undefined,
            })
            const businessAbort = new AbortController()
            try {
              set({ abortController: businessAbort })
              await instance.handleUserAction(originalArgs)
            } finally {
              if (
                call.name === 'oauth_request_access' &&
                get().toolCallsById[id]?.result?.opened !== true
              )
                attemptedTools.delete(key)
              if (get().abortController === businessAbort) set({ abortController: null })
            }
          }
        } catch (error) {
          if (current() && samePendingOrigin(get().toolCallsById[id]?.pending, intent.pending))
            get().recordToolFailure(id, fail(error))
          if (['reject', 'decline'].includes(intent.kind)) throw error
        } finally {
          closeOAuthWindow?.()
          release()
          inFlightTools.delete(id)
        }
      }
      return {
        ...initialState,
        ...readPreference(),
        openWorkflowChatDeployment: async (toolCallId, scope) => {
          if (get().workflowChatDeployment)
            throw new Error('A workflow deployment dialog is already owned by this conversation')
          const chat = get().currentChat
          if (!chat) throw new Error('Native tool thread is missing')
          const generation = epoch
          const model = get().selectedModel
          const signal = get().abortController?.signal
          const pending = await get().readPendingTool(toolCallId)
          const args = ToolArgSchemas.deploy_workflow.parse(pending.originalArgs)
          const id = crypto.randomUUID()
          const isCurrent = () => {
            if (!ownsChat(chat, generation) || get().selectedModel !== model) return false
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
        draft: emptyDraft(),
        setAccessLevel: (accessLevel) => {
          if (isCopilotBusy(get()) || get().accessLevel === accessLevel) return
          set({ accessLevel })
        },
        setDraft: (update) =>
          set((state) => ({ draft: typeof update === 'function' ? update(state.draft) : update })),
        setSelectedModel: (selectedModel) => {
          if (isCopilotBusy(get()) || get().selectedModel === selectedModel) return
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(
              dialog.id,
              'closed',
              'Native model selection changed'
            )
          titleAbort?.abort()
          if (preferenceKey) BrowserStorage.setItem(preferenceKey, { selectedModel })
          set({ selectedModel, reasoning: undefined })
        },
        setReasoning: (reasoning) => {
          if (isCopilotBusy(get()) || get().reasoning === reasoning) return
          if (preferenceKey)
            BrowserStorage.setItem(preferenceKey, { selectedModel: get().selectedModel, reasoning })
          set({ reasoning })
        },
        loadChats: async (options) => {
          const workspaceId =
            options?.workspaceId !== undefined ? options.workspaceId : get().conversationWorkspaceId
          const generation = ++threadsGeneration
          const id = epoch
          set({
            isLoadingChats: true,
            ...(!get().currentChat && !get().isSendingMessage && !get().isAwaitingContinuation
              ? { conversationWorkspaceId: workspaceId }
              : {}),
          })
          try {
            if (admission) await admission
            const threads = await listNativeThreads(workspaceId)
            if (generation !== threadsGeneration || id !== epoch) return
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
            ) {
              const currentChat = get().currentChat
              if (currentChat && !get().abortController && !observation && !workflow?.stopping)
                await restoreChat(currentChat)
              return
            }
            const remembered = getCopilotWorkspaceSelection(channelId, workspaceId)
            const selected = chats.find((chat) => chat.threadId === remembered)
            if (selected) await get().selectChat(selected)
            else await get().createNewChat(workspaceId)
          } catch (error) {
            if (generation === threadsGeneration && id === epoch) fail(error)
          } finally {
            if (generation === threadsGeneration) set({ isLoadingChats: false })
          }
        },
        selectChat: async (chat) => {
          const sameChat = ownsChat(chat, epoch)
          if (sameChat && workflow?.stopping) return
          if (!sameChat) workflow = undefined
          get().detachStream()
          ++epoch
          set({
            currentChat: chat,
            conversationWorkspaceId: chat.workspaceId,
            currentRunId: null,
            messages: [],
            toolCallsById: {},
            error: null,
            isAwaitingContinuation: false,
            isAborting: false,
            isSendingMessage: false,
          })
          rememberCopilotWorkspaceSelection(channelId, chat.workspaceId, chat.threadId)
          await restoreChat(chat) // Restored history never autoexecutes a tool.
        },
        createNewChat: async (workspaceId) => {
          workflow = undefined
          get().detachStream()
          ++epoch
          const scope = workspaceId === undefined ? get().conversationWorkspaceId : workspaceId
          rememberCopilotWorkspaceSelection(channelId, scope, null)
          set({
            currentChat: null,
            conversationWorkspaceId: scope,
            currentRunId: null,
            messages: [],
            toolCallsById: {},
            draft: emptyDraft(),
            error: null,
            isAwaitingContinuation: false,
            isAborting: false,
            isSendingMessage: false,
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
          if ((!message.trim() && !options.images?.length) || isCopilotBusy(get())) return false
          const model = get().selectedModel
          const reasoning = get().reasoning
          if (!model) {
            set({ error: 'Select an available Copilot model before sending a message.' })
            return false
          }
          const chat = get().currentChat
          const editing = options.messageId !== undefined
          const editIndex = editing
            ? get().messages.findIndex((item) => item.id === options.messageId)
            : -1
          if (editing && (!chat || editIndex < 0 || get().messages[editIndex].role !== 'user')) {
            set({ error: 'Select an existing user message to edit.' })
            return false
          }
          if (editing && hasToolActivityAfterMessage(get().messages, options.messageId!)) {
            set({ error: EDIT_REPLAY_BLOCKED_MESSAGE })
            return false
          }
          const workspaceId = chat ? chat.workspaceId : get().conversationWorkspaceId
          workflow = undefined
          get().detachStream()
          const id = ++epoch
          titleAbort?.abort()
          titleCandidate = null
          const contexts = editing
            ? (get().messages[editIndex].contexts ?? [])
            : mergeCopilotContexts({
                explicitContexts: options.contexts,
                implicitContexts: options.runtimeContext?.implicitContexts,
              })
          const toolContext = buildTurnProvenanceFromContexts(
            contexts,
            editing ? workspaceId : options.runtimeContext?.workspaceId
          )
          try {
            const initial =
              !editing && (!chat || (chat.title === '' && get().messages.length === 0))
            const command: CopilotRequest = {
              command: 'message',
              requestId: crypto.randomUUID(),
              toolContext,
              workspaceId,
              ...(chat ? { threadId: chat.threadId } : {}),
              ...(editing ? { messageId: options.messageId } : {}),
              model,
              ...(reasoning ? { reasoning } : {}),
              input: {
                contexts,
                content: options.images?.length
                  ? [{ type: 'text', text: message }, ...options.images]
                  : message,
              },
              accessLevel: get().accessLevel,
            }
            const body = serializeCopilotRequest(command)
            titleCandidate =
              initial && message.trim()
                ? {
                    epoch,
                    workspaceId,
                    model,
                    originalInput: message,
                    ...(chat ? { threadId: chat.threadId } : {}),
                  }
                : null
            const user = createUserMessage(message, options.images, contexts, options.messageId)
            const assistant = createStreamingMessage()
            set((state) => ({
              ...(!editing ? { messages: [...state.messages, user, assistant] } : {}),
              isSendingMessage: true,
              error: null,
              currentRunId: null,
            }))
            if (id !== epoch) return false
            const success = await invoke(command, assistant.id, body, options.onAccepted)
            return success && id === epoch
          } catch (error) {
            if (id === epoch) fail(error)
            return false
          }
        },
        abortMessage: async () => {
          if (get().isAborting) return false
          const ownerSignal = owner.signal
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(dialog.id, 'closed', 'Native tool selection changed')
          const current = get()
          const ownedWorkflow =
            workflow &&
            current.currentChat?.workspaceId === workflow.workspaceId &&
            current.currentChat.threadId === workflow.target.threadId &&
            (!current.currentRunId || current.currentRunId === workflow.target.runId)
              ? workflow
              : undefined
          const currentRunId = current.currentRunId ?? ownedWorkflow?.target.runId
          let cancellationEpoch = epoch
          let target =
            current.currentChat && currentRunId
              ? {
                  workspaceId: current.currentChat.workspaceId,
                  threadId: current.currentChat.threadId,
                  runId: currentRunId,
                }
              : undefined
          titleAbort?.abort()
          titleCandidate = null
          try {
            if (!target && current.isSendingMessage && admission) {
              set({ isAborting: true })
              const result = await admission
              if (result.status !== 'accepted') throw new Error('Copilot command was not accepted')
              target = {
                workspaceId: current.currentChat
                  ? current.currentChat.workspaceId
                  : current.conversationWorkspaceId,
                threadId: result.threadId,
                runId: result.runId,
              }
            }
            if (cancellationEpoch === epoch) {
              cancellationEpoch = ++epoch
              if (ownedWorkflow) ownedWorkflow.stopping = true
              get().detachStream()
              set((state) => ({
                ...settleDisplayOnlyTools(state),
                currentRunId: target?.runId ?? null,
                isSendingMessage: false,
                isAborting: Boolean(target),
                isAwaitingContinuation: Boolean(target),
              }))
            }
            const [native, cancelledWorkflow] = await Promise.allSettled([
              target && readNativeCommand({ command: 'cancel', ...target }, ownerSignal),
              ownedWorkflow?.admission.then(
                (handle) => {
                  ownerSignal.throwIfAborted()
                  return cancelQueuedWorkflowExecution(handle.taskId)
                },
                (error) => {
                  // An explicit queue refusal guarantees there is no workflow to cancel.
                  if (!(error instanceof WorkflowQueueAdmissionError)) throw error
                }
              ),
            ])
            if (cancellationEpoch !== epoch) return false
            if (cancelledWorkflow.status === 'rejected') throw cancelledWorkflow.reason
            if (workflow === ownedWorkflow) workflow = undefined
            if (!target) return !current.isSendingMessage
            if (native.status === 'rejected') throw native.reason
            const result = native.value
            if (result?.status !== 'cancel_requested' || result.runId !== target.runId)
              throw new Error('Native cancellation was not verified')
            set((state) => applyNativeCancellation(state, result))
            return true
          } catch (error) {
            if (cancellationEpoch === epoch) {
              set({ isAborting: false, isSendingMessage: false })
              fail(error)
            }
            return false
          } finally {
            refreshBillingUsage()
          }
        },
        detachStream: () => {
          const dialog = get().workflowChatDeployment
          if (dialog)
            get().settleWorkflowChatDeployment(dialog.id, 'closed', 'Native tool owner changed')
          ++threadsGeneration
          observation?.abort()
          observation = null
          get().abortController?.abort()
          for (const [id, call] of Object.entries(get().toolCallsById)) {
            if (getClientTool(id) && call.pending && call.state === ClientToolCallState.executing)
              updateTool(id, ClientToolCallState.error)
            unregisterClientTool(id)
          }
          set({ abortController: null, isLoadingChats: false })
        },
        reset: () => {
          workflow = undefined
          ++epoch
          owner.abort()
          owner = new AbortController()
          titleAbort?.abort()
          titleCandidate = null
          get().detachStream()
          inFlightTools.clear()
          attemptedTools.clear()
          refreshedTools.clear()
          set({ ...initialState, ...readPreference(), draft: emptyDraft() })
        },
        readPendingTool: async (toolCallId) => {
          const call = get().toolCallsById[toolCallId]
          const pending = call?.pending
          if (
            !pending ||
            nativeToolCallId(pending.target) !== toolCallId ||
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
          const pending = await get().readPendingTool(id)
          const current = () =>
            ownsChat(chat, generation) &&
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
            const toolCallsById = { ...state.toolCallsById, [id]: call }
            return {
              toolCallsById,
              messages: updateMessageToolCalls(state.messages, toolCallsById),
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
          const pending = await get().readPendingTool(id)
          if (pending.stage !== 'result')
            throw new Error('Native approval is required before readback')
          const context = get().toolCallsById[id]?.provenance
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
          if (!ownsChat(chat, generation))
            throw new DOMException('Workflow observation detached', 'AbortError')
          if (!success) throw new Error('Authoritative readback did not complete')
        },
        setToolState: updateTool,
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
  if (activeAuthenticatedUserId !== null) resetCopilotWorkspaceSelectionState()
  activeAuthenticatedUserId = userId
}
registerCopilotStoreForToolCallResolver((id) => {
  const stores = [...copilotStoreRegistry.values()].filter(
    (store) => store.getState().toolCallsById[id]
  )
  if (stores.length !== 1) throw new Error(`No unique active Copilot store owns tool call ${id}`)
  return stores[0]
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
    return () => store.getState().detachStream()
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
