import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COPILOT_CONTEXT_PART,
  type CopilotRequest,
  type Pending,
} from '@/lib/copilot/native/contract'
import { nativeToolCallId } from '@/lib/copilot/native/identity'
import { MAX_COPILOT_REQUEST_BYTES } from '@/lib/copilot/native/request-size'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  getClientTool,
  registerClientTool,
  unregisterClientTool,
} from '@/lib/copilot/tools/client/manager'
import { SleepClientTool } from '@/lib/copilot/tools/client/other/sleep'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import { runQueuedWorkflowExecution } from '@/lib/workflows/queued-execution-client'
import { organizationKeys } from '@/hooks/queries/organization'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { useExecutionStore } from '@/stores/execution/store'
import { buildCopilotWorkspaceChannelId } from './channel-id'
import { getCopilotStore, resetCopilotStoreRegistry } from './store'
import { getCopilotStoreForToolCall } from './store-access'
import { hasUiActiveToolCalls, isCopilotBusy } from './store-state'
import { applyNativeEvent, displayNativePending } from './streaming'
import type { CopilotChat } from './types'
import { getCopilotWorkspaceSelection } from './workspace-selection'

const tools = vi.hoisted(() => ({
  actualOAuth: false,
  actualRunWorkflow: false,
  runWorkflow: vi.fn(),
  refresh: vi.fn(),
  browser: vi.fn(),
  bind: vi.fn(),
}))
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
vi.mock('@/app/query-provider', () => ({ getQueryClient: () => queryClient }))
vi.unmock('@/stores/execution/store')
vi.mock('@/lib/copilot/tools/client/workflow/workflow-execution-utils', () => ({
  executeWorkflowWithFullLogging: tools.runWorkflow,
}))
vi.mock('./tool-registry', async (original) => {
  const registry = await original<typeof import('./tool-registry')>()
  return {
    ...registry,
    handleCopilotServerToolSuccess: tools.refresh,
    ensureClientToolInstance: (...args: Parameters<typeof registry.ensureClientToolInstance>) =>
      (tools.actualOAuth && args[0] === 'oauth_request_access') ||
      (tools.actualRunWorkflow && args[0] === 'run_workflow')
        ? registry.ensureClientToolInstance(...args)
        : {
            handleUserAction: tools.browser,
            setExecutionContext: tools.bind,
          },
  }
})
const threadId = 'thread-fixture'
const workspaceId = 'workspace-fixture'
const actorUserId = 'actor-fixture'
const runId = 'run-fixture'
const at = '2026-11-08T00:00:00.000Z'
const chat = (workspace: string | null = workspaceId, id = threadId): CopilotChat => ({
  threadId: id,
  workspaceId: workspace,
  title: 'Existing title',
  createdAt: new Date(at),
  updatedAt: new Date(at),
})
const pending = (stage: Pending['stage'] = 'result', toolName = 'read_workflow'): Pending => ({
  target: { threadId, resourceId: 'resource-fixture', runId, toolCallId: 'call-fixture', toolName },
  stage,
  originalArgs: { workflowId: 'entity-fixture' },
})
const defer = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const json = (value: unknown, status = 200) => Response.json(value, { status })
const ready = (text = 'canonical answer') => ({ status: 'completed', threadId, runId, text })
const suspended = (items: Pending[]) => ({
  status: 'suspended',
  threadId,
  runId,
  text: '',
  pending: items,
})
let admittedObservation: Response | undefined
const acceptObservation = (
  response: Response,
  id = threadId,
  messageId = 'user-native',
  nativeRunId = runId
) => {
  admittedObservation = response
  return json({ status: 'accepted', threadId: id, runId: nativeRunId, messageId }, 202)
}
const acceptTurn = (
  value: ReturnType<typeof ready> | ReturnType<typeof suspended> = ready(),
  events: object[] = []
) => {
  const result = {
    ...('pending' in value
      ? pendingHistory(value.pending)
      : historyResult([
          history[0],
          { ...history[1], runId: value.runId, parts: [{ type: 'text', text: value.text }] },
        ])),
    threadId: value.threadId,
  }
  return acceptObservation(
    eventResponse([
      {
        type: 'thread.history',
        result: historyResult([history[0]], [], value.threadId),
        activeRunId: value.runId,
      },
      { type: 'thread.started', runId: value.runId, messageId: history[1].id },
      ...events.map((event) => ({ type: 'thread.output', runId: value.runId, event })),
      {
        type: 'thread.status',
        runId: value.runId,
        status: value.status === 'completed' ? 'success' : 'suspended',
        history: result,
      },
    ]),
    value.threadId,
    'user-native',
    value.runId
  )
}
const history = [
  {
    id: 'user-native',
    role: 'user',
    createdAt: at,
    parts: [{ type: 'text', text: 'actual native input' }],
  },
  {
    id: 'assistant-native',
    role: 'assistant',
    runId,
    createdAt: at,
    parts: [{ type: 'text', text: 'canonical answer' }],
  },
]
const historyResult = (items: unknown[] = history, pending: Pending[] = [], id = threadId) => ({
  status: 'history',
  threadId: id,
  items,
  pending,
})
const toolHistory = (
  invocations: object[],
  pending: Pending[] = [],
  nativeRunId = pending[0]?.target.runId ?? runId
) =>
  historyResult(
    [
      history[0],
      {
        ...history[1],
        runId: nativeRunId,
        parts: [
          ...history[1].parts,
          ...invocations.map((toolInvocation) => ({
            type: 'tool-invocation',
            toolInvocation,
          })),
        ],
      },
    ],
    pending
  )
const pendingHistory = (pending: Pending[]) =>
  toolHistory(
    pending.map((item) => ({
      state: 'call',
      toolCallId: item.target.toolCallId,
      toolName: item.target.toolName,
      args: item.originalArgs,
    })),
    pending
  )
const historyResponse = (pending: Pending[]) => observingStream(pendingHistory(pending)).response

let commands: CopilotRequest[]
let onCommand: (
  request: CopilotRequest,
  init?: RequestInit
) => Promise<Response> | Response | undefined
let onTitle: (body: any, init?: RequestInit) => Promise<Response> | Response
let onObserve: (
  request: Extract<CopilotRequest, { command: 'thread.observe' }>,
  init?: RequestInit
) => Promise<Response> | Response
let titleRequests: any[]
let workflowRequests: string[]
let onWorkflow: (id: string) => Response | Promise<Response>
const store = () =>
  getCopilotStore(buildCopilotWorkspaceChannelId({ authenticatedUserId: actorUserId, workspaceId }))
const setChat = () =>
  store().setState({ currentChat: chat(), conversationWorkspaceId: workspaceId })
const reconnectSelectedChat = async () => {
  store().getState().detachStream()
  await store().getState().loadChats({ workspaceId: store().getState().currentChat!.workspaceId })
}
const installPending = (item: Pending) => {
  setChat()
  store().setState({
    currentRunId: runId,
    toolCallsById: {
      [nativeToolCallId(item.target)]: {
        id: nativeToolCallId(item.target),
        name: item.target.toolName,
        state: item.preview ? ClientToolCallState.review : ClientToolCallState.pending,
        ...(item.preview ? { result: item.preview } : {}),
        params: item.originalArgs,
        pending: item,
      },
    },
  })
}
function defaultResponse(request: CopilotRequest) {
  if (request.command === 'thread.observe')
    return observingStream(historyResult(history, [], request.threadId)).response
  if (request.command === 'threads.list')
    return json({
      status: 'threads',
      items: [{ id: threadId, title: 'verified title', createdAt: at, updatedAt: at }],
    })
  if (request.command === 'thread.title' || request.command === 'thread.delete')
    return json({
      status: 'updated',
      operation: request.command,
      threadId: request.threadId,
    })
  if (request.command === 'cancel')
    return json({
      status: 'cancel_requested',
      runId: request.runId,
    })
  return acceptTurn(ready())
}
function eventStream(events: object[] = []) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const cancelled = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel: cancelled,
  })
  const emit = (event: object) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  events.forEach(emit)
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    emit,
    fail: (error: Error) => controller.error(error),
    close: () => controller.close(),
    cancelled,
  }
}
function outputStream(events: object[] = []) {
  return eventStream([
    { type: 'thread.history', result: historyResult([history[0]]), activeRunId: runId },
    { type: 'thread.started', runId, messageId: history[1].id },
    ...events.map((event) => ({ type: 'thread.output', runId, event })),
  ])
}
function eventResponse(events: object[]) {
  const stream = eventStream(events)
  stream.close()
  return stream.response
}
function observingStream(result = historyResult(), activeRunId: string | null = null) {
  return eventStream([
    { type: 'thread.history', result, activeRunId },
    ...(activeRunId
      ? []
      : [
          {
            type: 'thread.status',
            runId: result.pending[0]?.target.runId ?? runId,
            status: result.pending.length ? 'suspended' : 'success',
            history: result,
          },
        ]),
  ])
}
beforeEach(() => {
  const selections = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => selections.get(key) ?? null,
    setItem: (key: string, value: string) => selections.set(key, value),
    removeItem: (key: string) => selections.delete(key),
    clear: () => selections.clear(),
    key: (index: number) => [...selections.keys()][index] ?? null,
    get length() {
      return selections.size
    },
  })
  queryClient.clear()
  resetCopilotStoreRegistry()
  tools.actualOAuth = false
  tools.actualRunWorkflow = false
  tools.runWorkflow.mockReset().mockResolvedValue({ success: true, output: {}, logs: [] })
  useExecutionStore.getState().reset()
  store().setState({ selectedModel: 'anthropic/admin-selected-model' })
  commands = []
  titleRequests = []
  workflowRequests = []
  onWorkflow = (id) => json({ data: { id, workspaceId: 'original-entity-workspace' } })
  onCommand = () => undefined
  admittedObservation = undefined
  onObserve = async (request, init) => {
    const admitted = admittedObservation
    admittedObservation = undefined
    return (await onCommand(request, init)) ?? admitted ?? defaultResponse(request)
  }
  onTitle = () => json({ title: null })
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/workflows/')) {
        const id = decodeURIComponent(String(input).slice('/api/workflows/'.length))
        workflowRequests.push(id)
        return onWorkflow(id)
      }
      if (String(input) === '/api/copilot/title') {
        const body = JSON.parse(String(init?.body))
        titleRequests.push(body)
        return onTitle(body, init)
      }
      expect(String(input)).toBe('/api/copilot/native')
      const request = JSON.parse(String(init?.body)) as CopilotRequest
      commands.push(request)
      expect(Object.hasOwn(request, 'workspaceId')).toBe(true)
      expect(request).not.toHaveProperty('scope')
      expect(request).not.toHaveProperty('toolManifest')
      if (request.command === 'thread.observe') return onObserve(request, init)
      return (await onCommand(request, init)) ?? defaultResponse(request)
    })
  )
})
afterEach(() => {
  resetCopilotStoreRegistry()
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('canonical browser conversation transport', () => {
  it('restores the selected conversation and active run after transient state is discarded', async () => {
    onObserve = () => observingStream(historyResult(), runId).response
    await store().getState().selectChat(chat())
    const channelId = buildCopilotWorkspaceChannelId({
      authenticatedUserId: actorUserId,
      workspaceId,
    })
    expect(getCopilotWorkspaceSelection(channelId, workspaceId)).toBe(threadId)
    store().getState().reset()
    await store().getState().loadChats({ workspaceId })
    expect(store().getState()).toMatchObject({
      currentChat: { threadId },
      currentRunId: runId,
      isSendingMessage: true,
    })
    expect(
      commands.some((request) => request.command === 'message' || request.command === 'cancel')
    ).toBe(false)
    expect(
      getCopilotWorkspaceSelection(
        buildCopilotWorkspaceChannelId({ authenticatedUserId: 'another-user', workspaceId }),
        workspaceId
      )
    ).toBeUndefined()
    expect(await store().getState().abortMessage()).toBe(true)
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([
      { command: 'cancel', workspaceId, threadId, runId },
    ])
  })

  it('reconnects a lost admitted response, projects later output and never submits inference again', async () => {
    setChat()
    const generation = outputStream([{ type: 'text.delta', text: 'Before disconnect' }])
    const observer = eventStream([
      {
        type: 'thread.history',
        result: historyResult([history[0]]),
        activeRunId: runId,
      },
      {
        type: 'thread.started',
        runId,
        messageId: 'new-assistant',
      },
      {
        type: 'thread.output',
        runId,
        event: { type: 'text.delta', text: 'Replayed and live output' },
      },
    ])
    onCommand = (request) =>
      request.command === 'message' ? acceptObservation(generation.response) : undefined
    let observations = 0
    onObserve = () => (++observations === 1 ? generation.response : observer.response)
    const sending = store().getState().sendMessage('Read')
    await vi.waitFor(() =>
      expect(store().getState().messages.at(-1)?.content).toBe('Before disconnect')
    )
    generation.fail(new Error('Connection lost'))
    await vi.waitFor(
      () => expect(store().getState().messages.at(-1)?.content).toBe('Replayed and live output'),
      { timeout: 2500 }
    )
    expect(store().getState().isSendingMessage).toBe(true)
    observer.emit({
      type: 'thread.output',
      runId: 'older-run',
      event: { type: 'text.delta', text: 'Unrelated output' },
    })
    await Promise.resolve()
    expect(store().getState().currentRunId).toBe(runId)
    expect(store().getState().error).toBeNull()
    observer.emit({ type: 'thread.status', runId, status: 'success', history: historyResult() })
    expect(await sending).toBe(true)
    expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
    expect(store().getState().isSendingMessage).toBe(false)
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    expect(commands.filter((request) => request.command === 'thread.observe')).toHaveLength(2)
  })

  it('continues the same conversation after an expired run without resuming or replaying it', async () => {
    onObserve = (request) =>
      eventResponse([
        {
          type: 'thread.history',
          result: historyResult(history, [], request.threadId),
          activeRunId: null,
          interruptedRunId: runId,
        },
      ])
    await store().getState().selectChat(chat())
    expect(store().getState()).toMatchObject({
      isSendingMessage: false,
      isAwaitingContinuation: false,
      currentRunId: null,
      error: 'The previous response was interrupted. You can continue this conversation.',
    })
    expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
    expect(commands.map((request) => request.command)).toEqual(['thread.observe'])
    onObserve = () => observingStream(historyResult()).response
    expect(await store().getState().sendMessage('Continue here')).toBe(true)
    expect(commands.filter((request) => request.command === 'message')).toEqual([
      expect.objectContaining({
        threadId,
        workspaceId,
        input: { content: 'Continue here', contexts: [] },
      }),
    ])
    expect(store().getState()).toMatchObject({ currentChat: { threadId }, currentRunId: null })
    expect(
      commands.some(
        (request) => request.command === 'cancel' || request.command.startsWith('tool.')
      )
    ).toBe(false)
  })

  it.each([false, true])(
    'uses the native assistant identity when observing a new or saved response (saved=%s)',
    async (saved) => {
      const assistantId = 'next-assistant'
      const nextUser = {
        ...history[0],
        id: 'next-user',
        parts: [{ type: 'text', text: 'Question from another tab' }],
      }
      const nextAssistant = {
        ...history[1],
        id: assistantId,
        parts: [{ type: 'text', text: 'First part' }],
      }
      const observer = observingStream(
        historyResult(saved ? [...history, nextUser, nextAssistant] : history),
        saved ? runId : null
      )
      onObserve = () => observer.response
      await store().getState().selectChat(chat())
      observer.emit({ type: 'thread.started', runId, messageId: assistantId })
      observer.emit({
        type: 'thread.output',
        runId,
        event: { type: 'text.delta', text: ' live output' },
      })
      await vi.waitFor(() =>
        expect(store().getState().messages.at(-1)).toMatchObject({
          id: assistantId,
          content: saved ? 'First part live output' : ' live output',
        })
      )
      expect(
        store()
          .getState()
          .messages.find((item) => item.id === history[1].id)?.content
      ).toBe('canonical answer')
      expect(
        store()
          .getState()
          .messages.filter((item) => item.id === assistantId)
      ).toHaveLength(1)
      observer.emit({
        type: 'thread.status',
        runId,
        status: 'success',
        history: historyResult([
          ...history,
          nextUser,
          { ...nextAssistant, parts: [{ type: 'text', text: 'Final answer' }] },
        ]),
      })
      await vi.waitFor(() =>
        expect(
          store()
            .getState()
            .messages.slice(-2)
            .map((item) => item.content)
        ).toEqual(['Question from another tab', 'Final answer'])
      )
      expect(
        commands.some((request) => request.command === 'message' || request.command === 'cancel')
      ).toBe(false)
    }
  )

  it('stops observation instead of appending unidentifiable output to a previous answer', async () => {
    const observer = observingStream(historyResult(), runId)
    observer.emit({
      type: 'thread.output',
      runId,
      event: { type: 'text.delta', text: 'Unidentified' },
    })
    onObserve = () => observer.response
    await store().getState().selectChat(chat())
    await vi.waitFor(() => expect(store().getState().isSendingMessage).toBe(false))
    expect(store().getState().error).toContain('Response identity is unavailable')
    expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
    expect(observer.cancelled).toHaveBeenCalledOnce()
    expect(commands).toHaveLength(1)
  })

  it('clears a stopped run identity when refreshed history has no pending continuation', async () => {
    const observer = observingStream(historyResult(), runId)
    onObserve = () => observer.response
    await store().getState().selectChat(chat())
    observer.emit({
      type: 'thread.status',
      status: 'failed',
      history: historyResult(),
      runId,
      error: { code: 'STREAM_INTERRUPTED', message: 'Response interrupted' },
    })
    await vi.waitFor(() =>
      expect(store().getState()).toMatchObject({
        isSendingMessage: false,
        currentRunId: null,
        error: 'Response interrupted',
      })
    )
    observer.emit({ type: 'thread.started', runId, messageId: 'reconnected-assistant' })
    await vi.waitFor(() => expect(store().getState().currentRunId).toBe(runId))
    observer.emit({ type: 'thread.status', runId, status: 'success', history: historyResult() })
    await vi.waitFor(() =>
      expect(store().getState()).toMatchObject({
        isSendingMessage: false,
        currentRunId: null,
        error: null,
      })
    )
    expect(
      commands.some((request) => request.command === 'message' || request.command === 'cancel')
    ).toBe(false)
  })

  it.each([403, 501])(
    'does not retry a non-retryable observation response (%i)',
    async (status) => {
      const observing = vi.fn(() =>
        json(
          { status: 'refused', error: { code: 'FORBIDDEN', message: 'Observation unavailable' } },
          status
        )
      )
      onObserve = observing
      await store().getState().selectChat(chat())
      expect(observing).toHaveBeenCalledOnce()
      expect(store().getState().error).toBe('Observation unavailable')
      expect(store().getState().isSendingMessage).toBe(false)
    }
  )

  it('retries observation transport failures without starting another model request', async () => {
    const observing = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          { status: 'failed', error: { code: 'UNAVAILABLE', message: 'Temporary disconnect' } },
          503
        )
      )
      .mockImplementation(() => observingStream(historyResult(), runId).response)
    onObserve = observing
    await store().getState().selectChat(chat())
    expect(store().getState().error).toBeNull()
    await vi.waitFor(() => expect(observing).toHaveBeenCalledTimes(2), { timeout: 1500 })
    await vi.waitFor(() =>
      expect(store().getState()).toMatchObject({
        currentRunId: runId,
        isSendingMessage: true,
        error: null,
      })
    )
    await store().getState().createNewChat()
    expect(
      commands.some((request) => request.command === 'message' || request.command === 'cancel')
    ).toBe(false)
  })

  it.each(['completed', 'suspended', 'failed'] as const)(
    'refreshes mounted personal and organization usage after a %s turn',
    async (status) => {
      let currentUsage = 0.1
      const observers = [subscriptionKeys.user(), organizationKeys.billing('org')].map(
        (queryKey) =>
          new QueryObserver(queryClient, {
            queryKey,
            queryFn: async () => currentUsage,
            staleTime: Number.POSITIVE_INFINITY,
          })
      )
      const unsubscribe = observers.map((observer) => observer.subscribe(() => {}))
      try {
        await vi.waitFor(() =>
          expect(observers.map((observer) => observer.getCurrentResult().data)).toEqual([0.1, 0.1])
        )
        setChat()
        onCommand = (command) => {
          if (command.command !== 'message') return
          currentUsage = 0.18
          return status === 'failed'
            ? acceptObservation(
                eventResponse([
                  {
                    type: 'thread.status',
                    runId,
                    status: 'failed',
                    history: historyResult(),
                    error: { code: 'GENERATION_FAILED', message: 'Interrupted' },
                  },
                ])
              )
            : acceptTurn(status === 'completed' ? ready() : suspended([]))
        }
        expect(await store().getState().sendMessage('Describe')).toBe(status !== 'failed')
        await vi.waitFor(() =>
          expect(observers.map((observer) => observer.getCurrentResult().data)).toEqual([
            0.18, 0.18,
          ])
        )
      } finally {
        unsubscribe.forEach((stop) => stop())
      }
    }
  )

  it('serializes the current access level after native history hydration settles', async () => {
    store().getState().setAccessLevel('full')
    const held = defer<Response>()
    onCommand = (command) =>
      command.command === 'thread.observe' && commands.length === 1 ? held.promise : undefined
    const selecting = store()
      .getState()
      .selectChat({ ...chat(), title: '' })
    await vi.waitFor(() =>
      expect(commands.map((command) => command.command)).toEqual(['thread.observe'])
    )
    store().getState().setAccessLevel('limited')
    held.resolve(observingStream(historyResult([])).response)
    await selecting
    expect(await store().getState().sendMessage('Describe')).toBe(true)
    expect(commands.find((command) => command.command === 'message')).toMatchObject({
      accessLevel: 'limited',
    })
  })

  it.each(['message', 'edit'])(
    'preserves the draft, run identity and displayed history when an oversized %s is refused locally',
    async (mode) => {
      await store().getState().selectChat(chat())
      commands.length = 0
      const messages = store().getState().messages
      const submittedDraft = { text: 'Describe these images', contexts: [] }
      const onAccepted = vi.fn()
      store().setState({ draft: submittedDraft, currentRunId: 'retained-run' })
      const images = [
        {
          type: 'image' as const,
          image: `data:image/png;base64,${'A'.repeat(MAX_COPILOT_REQUEST_BYTES)}`,
          mediaType: 'image/png',
        },
      ]
      expect(
        await store()
          .getState()
          .sendMessage(submittedDraft.text, {
            images,
            onAccepted,
            ...(mode === 'edit' ? { messageId: history[0].id } : {}),
          })
      ).toBe(false)
      expect(commands).toEqual([])
      expect(onAccepted).not.toHaveBeenCalled()
      expect(titleRequests).toEqual([])
      expect(store().getState()).toMatchObject({
        currentRunId: 'retained-run',
        isSendingMessage: false,
        abortController: null,
        error: expect.stringContaining('10 MiB'),
      })
      expect(store().getState().draft).toBe(submittedDraft)
      expect(store().getState().messages).toBe(messages)
      expect(images).toHaveLength(1)
    }
  )

  it('counts merged implicit context and UTF-8 bytes in the complete command before any request', async () => {
    const submittedDraft = { text: 'Describe', contexts: [] }
    const onAccepted = vi.fn()
    store().setState({ draft: submittedDraft })
    const messages = store().getState().messages
    expect(
      await store()
        .getState()
        .sendMessage(submittedDraft.text, {
          onAccepted,
          images: [
            {
              type: 'image',
              image: `data:image/png;base64,${'A'.repeat(MAX_COPILOT_REQUEST_BYTES - 1024)}`,
              mediaType: 'image/png',
            },
          ],
          runtimeContext: {
            workspaceId,
            implicitContexts: [{ kind: 'docs', label: '文'.repeat(1024) }],
          },
        })
    ).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
    expect(store().getState().draft).toBe(submittedDraft)
    expect(store().getState().messages).toBe(messages)
    expect(store().getState().error).toContain('10 MiB')
  })

  it('starts unconfigured and refuses to send without a selected administrator model', async () => {
    resetCopilotStoreRegistry()
    expect(store().getState().selectedModel).toBeNull()
    expect(await store().getState().sendMessage('Hello')).toBe(false)
    expect(commands).toEqual([])
    expect(titleRequests).toEqual([])
    expect(store().getState().isSendingMessage).toBe(false)
  })

  it('sends exact input, then reads canonical history', async () => {
    store().setState({ currentChat: chat(null), selectedModel: 'openai/gpt-5.6-sol' })
    expect(
      await store()
        .getState()
        .sendMessage(' exact 🦆\n', { contexts: [{ kind: 'docs', label: 'Docs' }] })
    ).toBe(true)
    expect(commands[0]).toEqual({
      command: 'message',
      workspaceId: null,
      threadId,
      model: 'openai/gpt-5.6-sol',
      accessLevel: 'limited',
      input: { content: ' exact 🦆\n', contexts: [{ kind: 'docs', label: 'Docs' }] },
    })
    expect(
      store()
        .getState()
        .messages.map((message) => message.id)
    ).toEqual(['user-native', 'assistant-native'])
    expect(titleRequests).toEqual([])
  })
  it.each(['isSendingMessage', 'isAwaitingContinuation', 'isAborting', 'pending-tool'])(
    'keeps access and model immutable during %s',
    async (busyState) => {
      const selectedModel = store().getState().selectedModel
      store().getState().setAccessLevel('full')
      if (busyState === 'pending-tool')
        store().setState({
          toolCallsById: { pending: { name: 'sleep', state: ClientToolCallState.pending } as any },
        })
      else store().setState({ [busyState]: true })
      store().getState().setAccessLevel('limited')
      await store().getState().setSelectedModel('openai/gpt-5.6-sol')
      expect(store().getState()).toMatchObject({
        selectedModel,
        accessLevel: 'full',
      })
      if (busyState === 'pending-tool') store().setState({ toolCallsById: {} })
      else store().setState({ [busyState]: false })
      store().getState().setAccessLevel('limited')
      expect(store().getState().accessLevel).toBe('limited')
    }
  )
  it('merges live contexts without promoting UI workspace/entity locators to tool payload authority', async () => {
    setChat()
    await store()
      .getState()
      .sendMessage('Inspect', {
        contexts: [{ kind: 'docs', label: 'Docs' }],
        runtimeContext: {
          workspaceId,
          implicitContexts: [
            { kind: 'current_monitor', monitorId: 'monitor', workspaceId, label: 'Monitor' },
          ],
        },
      })
    expect(commands[0]).not.toHaveProperty('workflowId')
    expect(commands[0]).toMatchObject({
      input: {
        contexts: [
          { kind: 'docs', label: 'Docs' },
          { kind: 'current_monitor', monitorId: 'monitor', workspaceId, label: 'Monitor' },
        ],
      },
    })
  })
  it('retains image descriptors and the draft when the authenticated server refuses the source', async () => {
    store().getState().setDraft({ text: 'image prompt', contexts: [] })
    onCommand = (request) =>
      request.command === 'message'
        ? json(
            {
              status: 'refused',
              error: {
                code: 'FORBIDDEN',
                message: 'Source access denied',
              },
            },
            403
          )
        : undefined
    expect(
      await store()
        .getState()
        .sendMessage('image prompt', {
          images: [
            {
              type: 'image',
              image: 'data:image/png;base64,cGl4ZWw=',
              mediaType: 'image/png',
            },
          ],
        })
    ).toBe(false)
    expect(commands).toEqual([
      expect.objectContaining({
        command: 'message',
        input: {
          content: [
            { type: 'text', text: 'image prompt' },
            { type: 'image', image: 'data:image/png;base64,cGl4ZWw=', mediaType: 'image/png' },
          ],
          contexts: [],
        },
      }),
    ])
    expect(titleRequests).toEqual([])
    expect(store().getState().draft.text).toBe('image prompt')
    expect(store().getState().error).toBe('Source access denied')
  })
  it('sends image-only selection in original order as Studio source descriptors without a caption or title utility', async () => {
    const images = ['first', 'second'].map((id) => ({
      type: 'image' as const,
      image: `data:image/png;base64,${btoa(id)}`,
      mediaType: 'image/png',
    }))
    expect(await store().getState().sendMessage(' \n\t ', { images })).toBe(true)
    expect(commands.find((command) => command.command === 'message')).toMatchObject({
      input: {
        content: [{ type: 'text', text: ' \n\t ' }, ...images],
        contexts: [],
      },
    })
    expect(titleRequests).toEqual([])
  })
  it('refuses a wrong-command history mutation without inventing a model acceptance fact', async () => {
    setChat()
    onCommand = (request) => {
      if (request.command !== 'message') return
      const wrong = {
        status: 'updated',
        threadId,
        operation: 'thread.title',
      }
      return json(wrong)
    }
    expect(await store().getState().sendMessage('First')).toBe(false)
    expect(store().getState().error).toBe('Copilot command was not accepted')
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    expect(titleRequests).toEqual([])
  })
  it('preserves split UTF8, reasoning/text order and native final canonical content', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? acceptTurn(ready(), [
            { type: 'reasoning.delta', text: 'thinking🦆' },
            { type: 'text.delta', text: 'preview' },
          ])
        : undefined
    expect(await store().getState().sendMessage('Hello')).toBe(true)
    expect(store().getState().currentRunId).toBeNull()
    expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
  })
  it('settles display-only tools during a UI abort and waits for cancellation acknowledgement', async () => {
    setChat()
    const item = pending('approval')
    const acknowledgement = defer<Response>()
    const stream = outputStream([
      {
        type: 'tool.display',
        toolCallId: item.target.toolCallId,
        toolName: item.target.toolName,
      },
    ])
    onCommand = (request) =>
      request.command === 'cancel'
        ? acknowledgement.promise
        : request.command === 'message'
          ? acceptObservation(stream.response)
          : undefined
    const sending = store().getState().sendMessage('Read')
    await vi.waitFor(() =>
      expect(store().getState().toolCallsById[nativeToolCallId(item.target)]?.state).toBe(
        ClientToolCallState.generating
      )
    )
    expect(
      store()
        .getState()
        .messages.find((message) => message.role === 'user')?.id
    ).toBe(history[0].id)
    const stopping = store().getState().abortMessage()
    expect(store().getState().isAborting).toBe(true)
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
    expect(await store().getState().sendMessage('Wait for cancellation')).toBe(false)
    const cancel = commands.find((request) => request.command === 'cancel')!
    acknowledgement.resolve(defaultResponse(cancel))
    expect(await stopping).toBe(true)
    expect(await sending).toBe(false)
    expect(stream.cancelled).toHaveBeenCalledOnce()
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([
      expect.objectContaining({ threadId, runId, workspaceId }),
    ])
    expect(store().getState().isAborting).toBe(false)
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
    const call = store().getState().toolCallsById[nativeToolCallId(item.target)]
    expect(call.state).toBe(ClientToolCallState.aborted)
    expect(call.pending).toBeUndefined()
    expect(
      store()
        .getState()
        .messages.flatMap((message) => message.contentBlocks ?? [])
    ).toContainEqual(expect.objectContaining({ type: 'tool_call', toolCall: call }))
    onCommand = () => undefined
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })
  it('cancels a restored suspended run without a new streaming response', async () => {
    const item = pending('approval')
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    expect(store().getState().currentRunId).toBe(runId)
    queryClient.setQueryData(subscriptionKeys.user(), { current: 0.1 })
    expect(await store().getState().abortMessage()).toBe(true)
    expect(queryClient.getQueryState(subscriptionKeys.user())?.isInvalidated).toBe(true)
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([
      { command: 'cancel', workspaceId, threadId, runId },
    ])
    expect(store().getState().currentRunId).toBeNull()
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
    onCommand = () => undefined
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })
  it.each(['transport', 'server', 'wrong-run'] as const)(
    'keeps a text-only run cancellable after a %s cancellation failure',
    async (failure) => {
      setChat()
      const stream = outputStream([{ type: 'text.delta', text: 'Still writing' }])
      const error = {
        transport: 'Cancellation connection lost',
        server: 'Try Stop again',
        'wrong-run': 'Native cancellation was not verified',
      }[failure]
      onCommand = (request) => {
        if (request.command === 'cancel') {
          if (failure === 'transport') throw new TypeError(error)
          return failure === 'server'
            ? json({ status: 'failed', error: { code: 'CANCEL_FAILED', message: error } }, 503)
            : json({ status: 'cancel_requested', runId: 'different-run' })
        }
        if (request.command !== 'message') return
        return acceptObservation(stream.response)
      }
      const sending = store().getState().sendMessage('Write an answer')
      await vi.waitFor(() =>
        expect(store().getState().messages.at(-1)?.content).toBe('Still writing')
      )
      expect(store().getState().isAwaitingContinuation).toBe(false)
      expect(await store().getState().abortMessage()).toBe(false)
      expect(await sending).toBe(false)
      expect(stream.cancelled).toHaveBeenCalledOnce()
      expect(store().getState()).toMatchObject({
        currentRunId: runId,
        isSendingMessage: false,
        isAborting: false,
        isAwaitingContinuation: true,
        error,
      })
      expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
      expect(await store().getState().sendMessage('Must wait')).toBe(false)
      expect(store().getState().currentRunId).toBe(runId)
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
      onCommand = () => undefined
      expect(await store().getState().abortMessage()).toBe(true)
      expect(commands.filter((request) => request.command === 'cancel')).toEqual([
        { command: 'cancel', workspaceId, threadId, runId },
        { command: 'cancel', workspaceId, threadId, runId },
      ])
      expect(store().getState()).toMatchObject({
        currentRunId: null,
        isAwaitingContinuation: false,
      })
      expect(await store().getState().sendMessage('Next turn')).toBe(true)
    }
  )
  it.each([
    [
      { status: 'failed', error: { code: 'CANCEL_FAILED', message: 'Try Stop again' } },
      503,
      'Try Stop again',
    ],
    [
      { status: 'cancel_requested', runId: 'different-run' },
      200,
      'Native cancellation was not verified',
    ],
  ] as const)(
    'retains pending actions after an unsuccessful cancellation %j so Stop can retry',
    async (body, status, error) => {
      const item = pending('approval')
      installPending(item)
      store().setState({ isAwaitingContinuation: true })
      onCommand = (request) => (request.command === 'cancel' ? json(body, status) : undefined)
      expect(await store().getState().abortMessage()).toBe(false)
      expect(store().getState().error).toBe(error)
      expect(store().getState()).toMatchObject({
        currentRunId: runId,
        isAborting: false,
        isAwaitingContinuation: true,
      })
      expect(store().getState().toolCallsById[nativeToolCallId(item.target)].pending).toEqual(item)
      expect(await store().getState().sendMessage('Still suspended')).toBe(false)
      onCommand = () => undefined
      store().getState().abortMessage()
      await vi.waitFor(() =>
        expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
      )
    }
  )
  it('rejects a stale thread response without selecting it', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message' ? acceptTurn({ ...ready(), threadId: 'other' }) : undefined
    expect(await store().getState().sendMessage('Hello')).toBe(false)
    expect(store().getState().currentChat?.threadId).toBe(threadId)
  })
  it('does not overwrite a new selection with a late cancel acknowledgement', async () => {
    setChat()
    store().setState({ currentRunId: runId })
    const late = defer<Response>()
    onCommand = (request) => (request.command === 'cancel' ? late.promise : undefined)
    store().getState().abortMessage()
    await store().getState().createNewChat('another-workspace')
    const cancel = commands.find((command) => command.command === 'cancel')!
    late.resolve(defaultResponse(cancel))
    await vi.waitFor(() => expect(store().getState().currentRunId).toBeNull())
    expect(store().getState().conversationWorkspaceId).toBe('another-workspace')
  })
})

describe('failed pending continuations', () => {
  it.each([false, true])(
    'preserves an accepted failure and authoritative pending state (pending=%s)',
    async (withPending) => {
      setChat()
      const item = pending('approval', 'rename_workflow')
      const input = { ...history[0], parts: [{ type: 'text', text: 'Rename' }] }
      const saved = withPending ? pendingHistory([item]) : historyResult([input])
      const error = {
        code: 'GENERATION_FAILED',
        message: withPending ? 'Model request failed' : 'Model credentials are unavailable',
      }
      onCommand = (request) =>
        request.command === 'message'
          ? acceptObservation(
              eventResponse([
                { type: 'thread.history', result: historyResult([input]), activeRunId: runId },
                ...(withPending
                  ? [
                      { type: 'thread.started', runId, messageId: history[1].id },
                      {
                        type: 'thread.output',
                        runId,
                        event: { type: 'text.delta', text: 'Unsaved partial answer' },
                      },
                    ]
                  : []),
                { type: 'thread.status', runId, status: 'failed', history: saved, error },
              ])
            )
          : undefined
      const draft = { text: 'Next request', contexts: [] }
      const accepted = vi.fn(() => store().getState().setDraft(draft))
      expect(await store().getState().sendMessage('Rename', { onAccepted: accepted })).toBe(false)
      expect(accepted).toHaveBeenCalledOnce()
      expect(store().getState()).toMatchObject({
        error: error.message,
        currentRunId: withPending ? runId : null,
        isAwaitingContinuation: withPending,
        isSendingMessage: false,
        draft,
      })
      onObserve = () => observingStream(saved).response
      await reconnectSelectedChat()
      expect(store().getState().error).toBe(error.message)
      if (withPending) {
        expect(store().getState().toolCallsById[nativeToolCallId(item.target)].pending).toEqual(
          item
        )
      } else {
        expect(store().getState().messages).toMatchObject([{ id: input.id, content: 'Rename' }])
        onCommand = () => undefined
        onObserve = () => admittedObservation!
        expect(await store().getState().sendMessage(draft.text)).toBe(true)
      }
    }
  )

  it.each(
    (['approval', 'result'] as const).flatMap((stage) =>
      ['refused', 'error', 'http', 'transport'].map((failure) => ({ stage, failure }))
    )
  )('keeps a $stage run cancellable after a $failure continuation', async ({ stage, failure }) => {
    const item = pending(stage, stage === 'approval' ? 'rename_workflow' : 'edit_workflow')
    if (stage === 'result') item.preview = { requiresReview: true }
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    commands = []
    onCommand = (request) => {
      if (request.command === 'thread.observe') return historyResponse([item])
      if (request.command !== 'tool.approve' && request.command !== 'tool.execute') return
      if (failure === 'transport') throw new Error('Continuation transport failed')
      const result = {
        status: failure === 'error' ? 'failed' : 'refused',
        error: {
          code: 'STALE_TARGET',
          message: stage === 'approval' ? 'Copilot model unavailable' : 'Copilot API key removed',
        },
      }
      return json(result, failure === 'error' ? 503 : 409)
    }

    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(store().getState()).toMatchObject({
      currentRunId: runId,
      isSendingMessage: false,
      isAwaitingContinuation: true,
    })
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)]).toMatchObject({
      state: ClientToolCallState.error,
      pending: item,
    })
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
    const messages = store().getState().messages
    expect(await store().getState().sendMessage('Blocked next turn')).toBe(false)
    expect(store().getState().messages).toBe(messages)
    expect(store().getState().currentRunId).toBe(runId)
    expect(commands.some((request) => request.command === 'message')).toBe(false)

    onCommand = (request) =>
      request.command === 'cancel'
        ? json(
            { status: 'failed', error: { code: 'FAILED', message: 'Cancellation delayed' } },
            503
          )
        : undefined
    expect(await store().getState().abortMessage()).toBe(false)
    expect(store().getState()).toMatchObject({
      currentRunId: runId,
      isAwaitingContinuation: true,
      isAborting: false,
    })
    onCommand = () => undefined
    expect(await store().getState().abortMessage()).toBe(true)
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([
      { command: 'cancel', workspaceId, threadId, runId },
      { command: 'cancel', workspaceId, threadId, runId },
    ])
    expect(store().getState()).toMatchObject({
      currentRunId: null,
      isAwaitingContinuation: false,
    })
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })

  it('releases the retained run when authoritative history confirms no pending work', async () => {
    const item = pending('approval', 'sleep')
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    const instance = new SleepClientTool(nativeToolCallId(item.target))
    registerClientTool(nativeToolCallId(item.target), instance)
    instance.setState(ClientToolCallState.generating)
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].state).toBe('generating')
    onCommand = (request) =>
      request.command === 'tool.approve'
        ? acceptObservation(
            eventResponse([
              {
                type: 'thread.status',
                runId,
                status: 'failed',
                history: historyResult(),
                error: { code: 'STALE_TARGET', message: 'Copilot API key removed' },
              },
            ])
          )
        : undefined
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(commands.filter((request) => request.command === 'thread.observe')).toHaveLength(2)
    expect(store().getState()).toMatchObject({
      currentRunId: null,
      isAwaitingContinuation: false,
    })
    expect(getClientTool(nativeToolCallId(item.target))).toBeUndefined()
    expect(() => instance.setState(ClientToolCallState.success)).not.toThrow()
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)]).toBeUndefined()
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })
})

describe('local pending approval and preview decisions', () => {
  it('keeps full-access approval explicit and sends no browser billing provenance', async () => {
    const item = pending('approval', 'make_api_request')
    installPending(item)
    store().setState({ accessLevel: 'full' })
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    expect(commands.some((request) => request.command === 'tool.approve')).toBe(false)
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    const approval = commands.find((request) => request.command === 'tool.approve')
    expect(approval).toMatchObject({ target: item.target, workspaceId })
    expect(approval).not.toHaveProperty('financialBinding')
    expect(
      commands.some(
        (request) => request.command === 'tool.execute' || request.command === 'tool.result'
      )
    ).toBe(false)
  })
  it('restores a persisted preview and accepts through one server-owned continuation', async () => {
    const item = pending('result', 'edit_workflow')
    item.preview = { requiresReview: true }
    installPending(item)
    store().setState((state) => displayNativePending(state, item))
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)]).toMatchObject({
      state: 'review',
      result: item.preview,
    })
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(commands.filter((request) => request.command === 'tool.execute')).toEqual([
      expect.objectContaining({
        target: item.target,
        action: 'review.accept',
      }),
    ])
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
  })
  it('declines approval without canceling unrelated work', async () => {
    const item = pending('approval')
    installPending(item)
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().skipCopilotToolCall(nativeToolCallId(item.target))
    expect(commands.some((request) => request.command === 'tool.decline')).toBe(true)
    expect(commands.some((request) => request.command === 'cancel')).toBe(false)
  })
  it('serializes server actions and discards queued work after navigation', async () => {
    const first = pending()
    const second = { ...structuredClone(first), target: { ...first.target, toolCallId: 'second' } }
    installPending(first)
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [nativeToolCallId(second.target)]: {
          id: nativeToolCallId(second.target),
          name: second.target.toolName,
          state: ClientToolCallState.pending,
          pending: second,
        },
      },
    }))
    const gate = defer<Response>()
    onCommand = (request) =>
      request.command === 'thread.observe'
        ? historyResponse([first, second])
        : request.command === 'tool.execute'
          ? gate.promise
          : undefined
    const active = store().getState().executeCopilotToolCall(nativeToolCallId(first.target))
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(true)
    )
    const queued = store().getState().executeCopilotToolCall(nativeToolCallId(second.target))
    await store().getState().createNewChat()
    gate.resolve(acceptTurn(ready()))
    await Promise.all([active, queued])
    expect(commands.filter((request) => request.command === 'tool.execute')).toHaveLength(1)
  })
  it('refuses ambiguous tool IDs across stores', () => {
    const item = pending()
    installPending(item)
    const other = getCopilotStore(
      buildCopilotWorkspaceChannelId({ authenticatedUserId: actorUserId, workspaceId: 'other' })
    )
    other.setState({ toolCallsById: store().getState().toolCallsById })
    expect(() => getCopilotStoreForToolCall(nativeToolCallId(item.target))).toThrow('unique')
  })
})

describe('canonical history, edits and context', () => {
  it('restores a repeated provider call as a separate pending card and resumes its raw target', async () => {
    const item = pending('approval', 'rename_workflow')
    item.target.toolCallId = 'functions.rename_workflow:0'
    const result = pendingHistory([item])
    const previous = structuredClone(result.items[1]) as any
    previous.id = 'previous-assistant'
    previous.runId = 'previous-run'
    Object.assign(previous.parts[1].toolInvocation, {
      state: 'result',
      result: { message: 'Previous rename' },
    })
    result.items.unshift(previous)
    onObserve = () => observingStream(result).response
    await store().getState().selectChat(chat())
    const id = nativeToolCallId(item.target)
    const previousId = nativeToolCallId({ ...item.target, runId: previous.runId })
    expect(Object.keys(store().getState().toolCallsById)).toHaveLength(2)
    expect(store().getState().toolCallsById[previousId]).toMatchObject({
      historical: true,
      state: ClientToolCallState.success,
      result: { message: 'Previous rename' },
    })
    expect(store().getState().toolCallsById[id]).toMatchObject({
      state: ClientToolCallState.pending,
      pending: item,
    })
    await store().getState().executeCopilotToolCall(id)
    expect(commands.find((request) => request.command === 'tool.approve')).toMatchObject({
      target: item.target,
    })
    expect(store().getState().toolCallsById[previousId].result).toEqual({
      message: 'Previous rename',
    })
  })
  it('loads display-only tool history without execution or local transcript writes', async () => {
    const item = pending()
    onObserve = () =>
      observingStream(
        toolHistory([
          {
            state: 'call',
            toolCallId: item.target.toolCallId,
            toolName: item.target.toolName,
            args: item.originalArgs,
          },
        ])
      ).response
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)]).toMatchObject({
      historical: true,
      state: 'aborted',
    })
    expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
  })
  it('opens canonical history without cancelling or erasing an active first turn', async () => {
    const abortController = new AbortController()
    const messages = [
      { id: 'active-user', role: 'user' as const, content: 'Working first turn', timestamp: at },
    ]
    store().setState({
      conversationWorkspaceId: workspaceId,
      isSendingMessage: true,
      abortController,
      messages,
    })
    await store().getState().loadChats({ workspaceId })
    expect(abortController.signal.aborted).toBe(false)
    expect(store().getState().messages).toEqual(messages)
    expect(store().getState().isSendingMessage).toBe(true)
    expect(commands.map((request) => request.command)).toEqual(['threads.list'])
  })
  it('regenerates an edited prompt through the same message command and keeps one user row', async () => {
    const originalContext = {
      kind: 'current_monitor' as const,
      label: 'Original monitor',
      workspaceId,
      monitorId: 'monitor-A',
    }
    const contextPart = { type: COPILOT_CONTEXT_PART, data: [originalContext] }
    onCommand = (request) =>
      request.command === 'thread.observe'
        ? observingStream(
            historyResult([
              { ...history[0], parts: [...history[0].parts, contextPart] },
              history[1],
            ])
          ).response
        : undefined
    await store().getState().selectChat(chat())
    commands.length = 0
    const text = ' exact edit\n'
    const answer = 'Replacement answer'
    onCommand = (request) =>
      request.command === 'message'
        ? acceptTurn(ready(answer))
        : request.command === 'thread.observe'
          ? observingStream(
              historyResult([
                { ...history[0], parts: [{ type: 'text', text }, contextPart] },
                { ...history[1], parts: [{ type: 'text', text: answer }] },
              ])
            ).response
          : undefined
    expect(
      await store()
        .getState()
        .sendMessage(text, {
          messageId: history[0].id,
          runtimeContext: {
            workspaceId: 'different-ui-workspace',
            implicitContexts: [
              { ...originalContext, monitorId: 'monitor-B', label: 'Current monitor' },
            ],
          },
        })
    ).toBe(true)
    expect(commands.map((request) => request.command)).toEqual(['message', 'thread.observe'])
    expect(commands[0]).toMatchObject({
      command: 'message',
      threadId,
      messageId: history[0].id,
      input: { content: text, contexts: [originalContext] },
      toolContext: { workspaceId },
    })
    expect(
      store()
        .getState()
        .messages.map(({ id, content }) => ({ id, content }))
    ).toEqual([
      { id: history[0].id, content: text },
      { id: history[1].id, content: answer },
    ])
  })
  it('retains the displayed answer until an edited request is admitted, including a refusal', async () => {
    await store().getState().selectChat(chat())
    const before = store().getState().messages
    const admission = defer<Response>()
    onCommand = (request) => (request.command === 'message' ? admission.promise : undefined)
    const editing = store().getState().sendMessage('Edited', { messageId: history[0].id })
    await vi.waitFor(() => expect(store().getState().isSendingMessage).toBe(true))
    expect(store().getState().messages).toEqual(before)
    admission.resolve(
      json(
        {
          status: 'refused',
          error: { code: 'STALE_TARGET', message: 'The previous turn is still finishing' },
        },
        409
      )
    )
    expect(await editing).toBe(false)
    expect(store().getState().messages).toEqual(before)
    expect(store().getState().error).toBe('The previous turn is still finishing')
  })
  it('reads the admitted edit from queued native history', async () => {
    await store().getState().selectChat(chat())
    const editedInput = { ...history[0], parts: [{ type: 'text', text: 'Edited prompt' }] }
    const stream = observingStream(historyResult([editedInput]), runId)
    onCommand = (request) =>
      request.command === 'message' ? acceptObservation(stream.response) : undefined
    const accepted = vi.fn()
    const editing = store()
      .getState()
      .sendMessage('Edited prompt', { messageId: history[0].id, onAccepted: accepted })
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(commands.filter(({ command }) => command === 'thread.observe')).toHaveLength(2)
    )
    expect(
      store()
        .getState()
        .messages.map(({ id, content }) => ({ id, content }))
    ).toEqual([{ id: history[0].id, content: 'Edited prompt' }])
    stream.emit({ type: 'thread.started', runId, messageId: 'edited-answer' })
    const editedHistory = historyResult([
      editedInput,
      { ...history[1], id: 'edited-answer', parts: [{ type: 'text', text: 'New answer' }] },
    ])
    stream.emit({ type: 'thread.status', runId, status: 'success', history: editedHistory })
    expect(await editing).toBe(true)
    expect(
      store()
        .getState()
        .messages.map(({ content }) => content)
    ).toEqual(['Edited prompt', 'New answer'])
  })

  it('refuses an edit that would erase native tool history before replacing its answer', async () => {
    await store().getState().selectChat(chat())
    store().setState({
      messages: [
        store().getState().messages[0],
        {
          ...store().getState().messages[1],
          contentBlocks: [
            {
              type: 'tool_call',
              timestamp: 1,
              toolCall: {
                id: 'completed-tool',
                name: 'read_workflow',
                state: ClientToolCallState.success,
              },
            },
          ],
        },
      ],
    })
    const before = store().getState().messages
    commands.length = 0
    expect(await store().getState().sendMessage('Edited', { messageId: history[0].id })).toBe(false)
    expect(store().getState().messages).toEqual(before)
    expect(commands).toEqual([])
    expect(store().getState().error).toContain('Start a new message after tool activity')
  })
})

describe('actual bounded initial-title publication', () => {
  it('calls utility for the actual first thread/model/scope and applies the title after native acknowledgement', async () => {
    store().setState({ conversationWorkspaceId: workspaceId, selectedModel: 'openai/gpt-5.6-sol' })
    const titleResponse = defer<Response>()
    onTitle = () => titleResponse.promise
    expect(await store().getState().sendMessage('First')).toBe(true)
    queryClient.setQueryData(subscriptionKeys.user(), { current: 0.1 })
    titleResponse.resolve(json({ title: 'Generated title' }))
    await vi.waitFor(() => expect(store().getState().currentChat?.title).toBe('Generated title'))
    expect(queryClient.getQueryState(subscriptionKeys.user())?.isInvalidated).toBe(true)
    expect(titleRequests).toEqual([
      { workspaceId, threadId, model: 'openai/gpt-5.6-sol', originalInput: 'First' },
    ])
    expect(commands.filter((request) => request.command === 'thread.title')).toEqual([
      expect.objectContaining({ title: 'Generated title' }),
    ])
    await store().getState().sendMessage('Second')
    expect(titleRequests).toHaveLength(1)
  })
  it.each(['completed', 'suspended'] as const)(
    'titles an existing canonical empty thread only after positive empty history and correlated %s terminal',
    async (status) => {
      let persisted = false
      onCommand = (request) => {
        if (request.command === 'thread.observe' && persisted && status === 'suspended')
          return historyResponse([pending('approval')])
        if (request.command === 'thread.observe' && !persisted)
          return observingStream(historyResult([])).response
        if (request.command !== 'message') return
        persisted = true
        const terminal = status === 'completed' ? ready() : suspended([pending('approval')])
        return acceptTurn(terminal)
      }
      await store()
        .getState()
        .selectChat({ ...chat(), title: '' })
      onTitle = () => json({ title: 'Generated title' })
      const originalInput = ' \nOriginal prompt🔥\t '
      expect(
        await store()
          .getState()
          .sendMessage(originalInput, {
            contexts: [{ kind: 'docs', label: 'Inert context never becomes prompt' }],
          })
      ).toBe(true)
      await vi.waitFor(() => expect(store().getState().currentChat?.title).toBe('Generated title'))
      expect(commands[0].command).toBe('thread.observe')
      expect(titleRequests).toEqual([
        { workspaceId, threadId, model: store().getState().selectedModel, originalInput },
      ])
      expect(commands.filter((request) => request.command === 'thread.title')).toHaveLength(1)
    }
  )
  it.each(['', ' ', 'Untitled', 'New Chat', null])(
    'does not infer initial state from a display title %s when native history exists',
    async (title) => {
      await store()
        .getState()
        .selectChat({ ...chat(), title })
      onTitle = () => json({ title: 'Generated title' })
      expect(await store().getState().sendMessage('A later native interaction')).toBe(true)
      expect(titleRequests).toEqual([]) // The default complete native history already contains a user.
    }
  )
  it('leaves the title unchanged when publication fails without replay', async () => {
    onTitle = () => json({ title: 'Generated title' })
    onCommand = (request) =>
      request.command === 'thread.title'
        ? json(
            {
              status: 'failed',
              error: {
                code: 'UNCERTAIN',
                message: 'Title publication outcome is uncertain',
              },
            },
            503
          )
        : undefined
    expect(await store().getState().sendMessage('First')).toBe(true)
    await vi.waitFor(() =>
      expect(store().getState().error).toContain('publication outcome is uncertain')
    )
    expect(store().getState().currentChat?.title).toBe('')
    expect(titleRequests).toHaveLength(1)
    expect(commands.filter((request) => request.command === 'thread.title')).toHaveLength(1)
  })
  it('publishes no title when the utility returns null and never retries', async () => {
    store().setState({ conversationWorkspaceId: workspaceId })
    onTitle = () => json({ title: null })
    await store().getState().sendMessage('First')
    await vi.waitFor(() => expect(titleRequests).toHaveLength(1))
    expect(commands.some((request) => request.command === 'thread.title')).toBe(false)
  })
  it.each(['manual-title', 'thread-switch', 'model-switch', 'new-user-message'])(
    'blocks late optional title publication after %s',
    async (change) => {
      store().setState({ conversationWorkspaceId: workspaceId })
      const late = defer<Response>()
      onTitle = () => late.promise
      await store().getState().sendMessage('First')
      await vi.waitFor(() => expect(titleRequests).toHaveLength(1))
      if (change === 'manual-title')
        store().setState({
          currentChat: { ...store().getState().currentChat!, title: 'Manual title' },
        })
      if (change === 'thread-switch') await store().getState().createNewChat('other-workspace')
      if (change === 'model-switch') await store().getState().setSelectedModel('openai/gpt-5.6-sol')
      if (change === 'new-user-message') await store().getState().sendMessage('Second')
      late.resolve(json({ title: 'Generated title' }))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(commands.some((request) => request.command === 'thread.title')).toBe(false)
      expect(titleRequests).toHaveLength(1)
    }
  )
})

describe('edited prompt ownership', () => {
  it('does not apply a late edited answer after selecting another conversation', async () => {
    await store().getState().selectChat(chat())
    const late = defer<Response>()
    onCommand = (request) => (request.command === 'message' ? late.promise : undefined)
    const editing = store().getState().sendMessage('edited A', { messageId: history[0].id })
    await store().getState().selectChat(chat(null, 'thread-B'))
    const before = store().getState().messages
    late.resolve(acceptTurn(ready('Answer for A')))
    expect(await editing).toBe(false)
    expect(store().getState().currentChat?.threadId).toBe('thread-B')
    expect(store().getState().messages).toEqual(before)
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
  })
})

describe('requested conversation scope survives discovery failure', () => {
  it.each([workspaceId, null])(
    'keeps requested scope %s on failure then sends there',
    async (requested) => {
      onCommand = (request) => {
        if (request.command === 'threads.list') throw new Error('discovery unavailable')
        return undefined
      }
      await store().getState().loadChats({ workspaceId: requested })
      expect(store().getState().conversationWorkspaceId).toBe(requested)
      await store().getState().sendMessage('exact scoped request')
      expect(commands.find((request) => request.command === 'message')?.workspaceId).toBe(requested)
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    }
  )
  it('retries discovery in the retained requested scope', async () => {
    onCommand = (request) => {
      if (request.command === 'threads.list') throw new Error('first discovery unavailable')
      return undefined
    }
    await store().getState().loadChats({ workspaceId })
    onCommand = () => undefined
    await store().getState().loadChats()
    expect(
      commands
        .filter((request) => request.command === 'threads.list')
        .map((request) => request.workspaceId)
    ).toEqual([workspaceId, workspaceId])
    expect(store().getState().conversationWorkspaceId).toBe(workspaceId)
  })
  it('keeps the newer explicit scope when the earlier discovery fails late', async () => {
    const first = defer<Response>()
    onCommand = (request) =>
      request.command === 'threads.list' && request.workspaceId === workspaceId
        ? first.promise
        : undefined
    const loading = store().getState().loadChats({ workspaceId })
    await store().getState().loadChats({ workspaceId: null })
    first.resolve(json({ error: 'unavailable' }, 503))
    await loading
    expect(store().getState().conversationWorkspaceId).toBeNull()
  })
  it('does not select a discovered chat after a new turn owns the requested scope', async () => {
    const discovery = defer<Response>()
    const message = defer<Response>()
    let original: CopilotRequest | undefined
    onCommand = (request) => {
      if (request.command === 'threads.list') return discovery.promise
      if (request.command === 'message') {
        original = request
        return message.promise
      }
    }
    const loading = store().getState().loadChats({ workspaceId })
    const sending = store().getState().sendMessage('new turn')
    await vi.waitFor(() => expect(original).toBeDefined())
    discovery.resolve(
      defaultResponse(commands.find((request) => request.command === 'threads.list')!)
    )
    await loading
    expect(store().getState().isSendingMessage).toBe(true)
    expect(store().getState().conversationWorkspaceId).toBe(workspaceId)
    expect(commands.some((request) => request.command === 'cancel')).toBe(false)
    message.resolve(acceptTurn(ready()))
    await sending
  })
  it('does not replace an active selected conversation on failed competing discovery', async () => {
    setChat()
    onCommand = (request) => {
      if (request.command === 'threads.list') throw new Error('unavailable')
      return undefined
    }
    await store().getState().loadChats({ workspaceId: 'other-workspace' })
    expect(store().getState().currentChat).toEqual(chat())
    expect(store().getState().conversationWorkspaceId).toBe(workspaceId)
  })
})

describe('reopened workflow pending cards', () => {
  it('restores public pending state and resolves the card locally without discovery', async () => {
    const item = {
      ...pending('result', 'deploy_workflow'),
      originalArgs: { entityId: 'original-workflow', action: 'deploy', deployType: 'api' },
    }
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat(null))
    commands = []
    const copy = await store().getState().readPendingTool(nativeToolCallId(item.target))
    expect(copy).toEqual(item)
    copy.originalArgs.changed = true
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].pending).toEqual(item)
    expect(commands).toEqual([])
    expect(workflowRequests).toEqual([])
    expect(tools.browser).not.toHaveBeenCalled()
  })
  it('rejects a displayed pending card belonging to a different thread', async () => {
    const item = pending()
    item.target.threadId = 'foreign-thread'
    installPending(item)
    await expect(store().getState().readPendingTool(nativeToolCallId(item.target))).rejects.toThrow(
      'selected thread'
    )
    expect(commands).toEqual([])
  })
})

describe('display-only tool settlement', () => {
  it('keeps genuine pending obligations when Stop settles only display-only activity', () => {
    const item = pending()
    installPending(item)
    store().setState((state) => ({
      ...applyNativeEvent(
        state,
        {
          type: 'tool.display',
          toolCallId: 'display-only',
          toolName: 'read_workflow',
        },
        'unknown-message'
      ),
    }))
    store().getState().abortMessage()
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].pending).toEqual(item)
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].state).toBe(
      ClientToolCallState.pending
    )
    expect(
      store().getState().toolCallsById[nativeToolCallId({ runId, toolCallId: 'display-only' })]
        .state
    ).toBe(ClientToolCallState.aborted)
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(true)
  })
})

describe('explicit reopened Drive business choice', () => {
  const drive = () => ({ ...pending('result', 'gdrive_request_access'), originalArgs: {} })
  const prepare = (item = drive()) => {
    installPending(item)
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url) === '/api/workspaces'
        ? json({ workspaces: [{ id: 'chosen-business', name: 'Chosen business' }] })
        : original(url, init)
    )
    return item
  }
  it('requires an explicit new workspace, distinct from personal conversation scope and original tool identity', async () => {
    const item = drive()
    prepare(item)
    store().setState({ currentChat: chat(null), conversationWorkspaceId: null })
    await expect(
      store().getState().authorizeToolWorkspace(nativeToolCallId(item.target))
    ).rejects.toThrow('Choose an authorized workspace')
    expect(
      await store()
        .getState()
        .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    ).toBe('chosen-business')
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].provenance).toEqual({
      workspaceId: 'chosen-business',
    })
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].pending).toEqual(item)
    expect(store().getState().currentChat?.workspaceId).toBeNull()
    await expect(
      store().getState().readbackCopilotToolCall(nativeToolCallId(item.target))
    ).rejects.toThrow('workspace and credential')
    expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
  })
  it('combines chosen credential readback and continuation in one authenticated command', async () => {
    const item = prepare()
    await store()
      .getState()
      .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    await store().getState().readbackCopilotToolCall(nativeToolCallId(item.target), {
      credentialId: 'explicit-credential',
    })
    expect(commands.filter((x) => x.command === 'tool.execute')).toEqual([
      expect.objectContaining({
        workspaceId,
        target: item.target,
        action: 'readback',
        context: { workspaceId: 'chosen-business' },
        readback: { credentialId: 'explicit-credential' },
      }),
    ])
    expect(commands.some((x) => x.command === 'tool.result')).toBe(false)
    expect(tools.browser).not.toHaveBeenCalled()
  })
  it('refuses the approval stage, unavailable or duplicate workspaces without losing Pending or contacting business services', async () => {
    const item = prepare({ ...drive(), stage: 'approval' })
    await expect(
      store().getState().authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    ).rejects.toThrow('Native approval')
    item.stage = 'result'
    await expect(
      store().getState().authorizeToolWorkspace(nativeToolCallId(item.target), 'foreign')
    ).rejects.toThrow('unavailable or ambiguous')
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url) === '/api/workspaces'
        ? json({ workspaces: [{ id: 'chosen-business' }, { id: 'chosen-business' }] })
        : original(url, init)
    )
    await expect(
      store().getState().authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    ).rejects.toThrow('unavailable or ambiguous')
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].pending).toEqual(item)
    expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
  })
  it.each(['navigation', 'pending-change'] as const)(
    'refuses delayed workspace authorization after %s',
    async (change) => {
      const item = prepare()
      const held = defer<Response>()
      const original = vi.mocked(fetch).getMockImplementation()!
      vi.mocked(fetch).mockImplementation(async (url, init) =>
        String(url) === '/api/workspaces' ? held.promise : original(url, init)
      )
      const operation = store()
        .getState()
        .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
      const outcome = expect(operation).rejects.toThrow('selection changed')
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces'))
      if (change === 'navigation') store().getState().createNewChat()
      else
        store().setState((state) => ({
          toolCallsById: {
            ...state.toolCallsById,
            [nativeToolCallId(item.target)]: {
              ...state.toolCallsById[nativeToolCallId(item.target)],
              pending: { ...item, stage: 'approval' },
            },
          },
        }))
      held.resolve(json({ workspaces: [{ id: 'chosen-business' }] }))
      await outcome
      expect(
        store().getState().toolCallsById[nativeToolCallId(item.target)]?.provenance?.workspaceId
      ).toBeUndefined()
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
    }
  )
})

describe('message acceptance', () => {
  it("shows a successor browser tool without executing another browser's turn", async () => {
    setChat()
    const item = { ...pending('result', 'sleep'), originalArgs: { seconds: 0 } }
    item.target = { ...item.target, runId: 'successor-run' }
    const stream = eventResponse([
      { type: 'thread.history', result: historyResult(), activeRunId: runId },
      { type: 'thread.started', runId: item.target.runId, messageId: 'successor-answer' },
      {
        type: 'thread.output',
        runId: item.target.runId,
        event: {
          type: 'tool.display',
          toolCallId: item.target.toolCallId,
          toolName: 'sleep',
          args: item.originalArgs,
        },
      },
      {
        type: 'thread.status',
        runId: item.target.runId,
        status: 'suspended',
        history: pendingHistory([item]),
      },
    ])
    onCommand = (request) => (request.command === 'message' ? acceptObservation(stream) : undefined)
    expect(await store().getState().sendMessage('Original request')).toBe(true)
    expect(store().getState().currentRunId).toBe(item.target.runId)
    expect(store().getState().isAwaitingContinuation).toBe(true)
    expect(tools.browser).not.toHaveBeenCalled()
    expect(commands.some((request) => request.command.startsWith('tool.'))).toBe(false)
  })

  it.each(['live', 'hydrated', 'completed'])(
    'follows the authoritative successor when another browser starts a %s turn',
    async (mode) => {
      setChat()
      const nextRunId = 'successor-run'
      const nextHistory = historyResult([
        ...history,
        { ...history[0], id: 'successor-user', parts: [{ type: 'text', text: 'Another browser' }] },
        {
          ...history[1],
          id: 'successor-answer',
          runId: nextRunId,
          parts: [{ type: 'text', text: 'Latest answer' }],
        },
      ])
      const stream = eventStream([
        {
          type: 'thread.history',
          result: mode === 'completed' ? nextHistory : historyResult(),
          activeRunId: mode === 'completed' ? null : mode === 'hydrated' ? nextRunId : runId,
        },
      ])
      onCommand = (request) =>
        request.command === 'message' ? acceptObservation(stream.response) : undefined
      const sending = store().getState().sendMessage('Original request')
      await vi.waitFor(() =>
        expect(commands.some((request) => request.command === 'thread.observe')).toBe(true)
      )
      if (mode !== 'completed') {
        stream.emit({ type: 'thread.started', runId: nextRunId, messageId: 'successor-answer' })
        stream.emit({
          type: 'thread.output',
          runId: nextRunId,
          event: { type: 'text.delta', text: 'Latest answer' },
        })
        await vi.waitFor(() => {
          expect(store().getState().currentRunId).toBe(nextRunId)
          expect(store().getState().messages.at(-1)?.content).toBe('Latest answer')
        })
      }
      stream.emit({
        type: 'thread.status',
        runId: nextRunId,
        status: 'success',
        history: nextHistory,
      })
      expect(await sending).toBe(true)
      expect(store().getState().currentRunId).toBeNull()
      expect(store().getState().isSendingMessage).toBe(false)
      expect(store().getState().messages.at(-1)?.content).toBe('Latest answer')
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    }
  )

  it('acknowledges admission and preserves the submitted user while the turn is queued', async () => {
    setChat()
    const admission = defer<Response>()
    const input = { ...history[0], parts: [{ type: 'text', text: 'submitted' }] }
    const stream = observingStream(historyResult([input]), runId)
    onCommand = (request) => (request.command === 'message' ? admission.promise : undefined)
    const onAccepted = vi.fn()
    const finished = vi.fn()
    const sending = store().getState().sendMessage('submitted', { onAccepted }).then(finished)
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'message')).toBe(true)
    )
    expect(onAccepted).not.toHaveBeenCalled()
    admission.resolve(acceptObservation(stream.response))
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledOnce())
    expect(
      store()
        .getState()
        .messages.map(({ role, content }) => ({ role, content }))
    ).toEqual([{ role: 'user', content: 'submitted' }])
    expect(store().getState().isSendingMessage).toBe(true)
    expect(finished).not.toHaveBeenCalled()
    stream.emit({ type: 'thread.started', runId, messageId: 'native-assistant' })
    stream.emit({ type: 'thread.output', runId, event: { type: 'text.delta', text: 'Working' } })
    await vi.waitFor(() => expect(store().getState().messages.at(-1)?.content).toBe('Working'))
    expect(
      store()
        .getState()
        .messages.filter(({ role }) => role === 'assistant')
    ).toHaveLength(1)
    stream.emit({
      type: 'thread.status',
      runId,
      status: 'success',
      history: historyResult([input, history[1]]),
    })
    await sending
    expect(finished).toHaveBeenCalledWith(true)
    expect(onAccepted).toHaveBeenCalledOnce()
  })

  it.each(['before-acceptance', 'after-acceptance', 'detached-again'])(
    'restores a first turn after returning to its workspace (%s)',
    async (timing) => {
      store().setState({ conversationWorkspaceId: workspaceId })
      const admission = defer<Response>()
      const stream = observingStream(historyResult([history[0]]), runId)
      onCommand = (request) => (request.command === 'message' ? admission.promise : undefined)
      const onAccepted = vi.fn()
      const sending = store().getState().sendMessage('submitted', { onAccepted })
      await vi.waitFor(() =>
        expect(commands.some(({ command }) => command === 'message')).toBe(true)
      )
      store().getState().detachStream()
      let restoring =
        timing === 'after-acceptance' ? undefined : store().getState().loadChats({ workspaceId })
      if (timing === 'detached-again') store().getState().detachStream()
      admission.resolve(acceptObservation(stream.response))
      expect(await sending).toBe(false)
      expect(store().getState()).toMatchObject({ currentChat: { threadId }, currentRunId: runId })
      expect(onAccepted).toHaveBeenCalledOnce()
      if (timing !== 'before-acceptance') {
        await restoring
        expect(commands.some(({ command }) => command === 'thread.observe')).toBe(false)
        expect(store().getState().isLoadingChats).toBe(false)
        restoring = store().getState().loadChats({ workspaceId })
      }
      await restoring
      expect(commands.filter(({ command }) => command === 'thread.observe')).toEqual([
        { command: 'thread.observe', workspaceId, threadId },
      ])
      expect(isCopilotBusy(store().getState())).toBe(true)
      stream.emit({ type: 'thread.status', runId, status: 'success', history: historyResult() })
      await vi.waitFor(() => expect(isCopilotBusy(store().getState())).toBe(false))
      expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
      expect(commands.filter(({ command }) => command === 'message')).toHaveLength(1)
      expect(commands.some(({ command }) => command === 'cancel')).toBe(false)
      expect(tools.browser).not.toHaveBeenCalled()
    }
  )

  it.each(['navigation', 'failure', 'detached-failure'])(
    'does not acknowledge a message after pre-start %s',
    async (kind) => {
      setChat()
      const held = defer<Response>()
      onCommand = (request) => (request.command === 'message' ? held.promise : undefined)
      const onAccepted = vi.fn()
      const sending = store().getState().sendMessage('submitted', { onAccepted })
      await vi.waitFor(() =>
        expect(commands.some((request) => request.command === 'message')).toBe(true)
      )
      if (kind === 'navigation') await store().getState().selectChat(chat('other', 'other'))
      if (kind === 'detached-failure') store().getState().detachStream()
      held.resolve(
        kind === 'navigation'
          ? acceptTurn(ready())
          : json(
              { status: 'refused', error: { code: 'INVALID_REQUEST', message: 'Not admitted' } },
              422
            )
      )
      expect(await sending).toBe(false)
      expect(onAccepted).not.toHaveBeenCalled()
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
      expect(isCopilotBusy(store().getState())).toBe(false)
      if (kind !== 'navigation') expect(store().getState().error).toBe('Not admitted')
    }
  )

  it.each(['existing', 'fresh', 'failed-cancel', 'refused', 'navigation', 'on-accepted'])(
    'retains admission until Stop can cancel its returned run (%s)',
    async (kind) => {
      if (kind === 'fresh') store().setState({ conversationWorkspaceId: workspaceId })
      else setChat()
      const admission = defer<Response>()
      const acknowledgement = defer<Response>()
      let admissionSignal: AbortSignal | null | undefined
      onCommand = (request, init) => {
        if (request.command === 'message') {
          admissionSignal = init?.signal
          return admission.promise
        }
        if (request.command === 'cancel') return acknowledgement.promise
      }
      let stopping: Promise<boolean> | undefined
      const onAccepted = vi.fn(() => {
        if (kind === 'on-accepted') stopping = store().getState().abortMessage()
      })
      const sending = store().getState().sendMessage('submitted', { onAccepted })
      await vi.waitFor(() =>
        expect(commands.some(({ command }) => command === 'message')).toBe(true)
      )
      if (kind !== 'on-accepted') {
        stopping = store().getState().abortMessage()
        expect(admissionSignal?.aborted).not.toBe(true)
        expect(store().getState().isAborting).toBe(true)
        expect(isCopilotBusy(store().getState())).toBe(true)
        expect(await store().getState().abortMessage()).toBe(false)
        expect(commands.some(({ command }) => command === 'cancel')).toBe(false)
      }
      if (kind === 'navigation') await store().getState().createNewChat('another-workspace')
      admission.resolve(
        kind === 'refused'
          ? json(
              { status: 'refused', error: { code: 'INVALID_REQUEST', message: 'Not admitted' } },
              422
            )
          : json({ status: 'accepted', threadId, runId, messageId: 'accepted-user' }, 202)
      )
      if (kind === 'refused') {
        expect(await stopping).toBe(false)
        expect(await sending).toBe(false)
        expect(onAccepted).not.toHaveBeenCalled()
        expect(isCopilotBusy(store().getState())).toBe(false)
        expect(commands.some(({ command }) => command === 'cancel')).toBe(false)
        return
      }
      await vi.waitFor(() =>
        expect(commands.filter(({ command }) => command === 'cancel')).toEqual([
          { command: 'cancel', workspaceId, threadId, runId },
        ])
      )
      expect(commands.some(({ command }) => command === 'thread.observe')).toBe(false)
      if (kind === 'navigation') {
        expect(onAccepted).not.toHaveBeenCalled()
        expect(store().getState().conversationWorkspaceId).toBe('another-workspace')
        expect(store().getState().currentChat).toBeNull()
      } else {
        expect(onAccepted).toHaveBeenCalledOnce()
        expect(store().getState()).toMatchObject({ currentRunId: runId, isAborting: true })
        expect(store().getState().messages[0]).toMatchObject({
          id: 'accepted-user',
          content: 'submitted',
        })
        expect(await store().getState().sendMessage('Must wait')).toBe(false)
      }
      acknowledgement.resolve(
        kind === 'failed-cancel'
          ? json({ status: 'failed', error: { code: 'CANCEL_FAILED', message: 'Retry Stop' } }, 503)
          : json({ status: 'cancel_requested', runId })
      )
      expect(await stopping).toBe(kind !== 'failed-cancel' && kind !== 'navigation')
      expect(await sending).toBe(false)
      expect(tools.browser).not.toHaveBeenCalled()
      if (kind === 'failed-cancel') {
        expect(store().getState()).toMatchObject({
          currentRunId: runId,
          isAwaitingContinuation: true,
          isAborting: false,
        })
        expect(await store().getState().sendMessage('Still running')).toBe(false)
        onCommand = () => undefined
        expect(await store().getState().abortMessage()).toBe(true)
        expect(commands.filter(({ command }) => command === 'cancel')).toHaveLength(2)
      }
      expect(store().getState().currentRunId).toBeNull()
      expect(isCopilotBusy(store().getState())).toBe(false)
      if (kind === 'navigation')
        expect(store().getState().conversationWorkspaceId).toBe('another-workspace')
    }
  )
})

describe('local workflow execution refusals', () => {
  const item = (): Pending => ({
    ...pending('result', 'run_workflow'),
    originalArgs: { entityId: 'original-workflow', triggerBlockId: 'original-trigger' },
  })
  const install = async () => {
    tools.actualRunWorkflow = true
    const target = item()
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([target]) : undefined
    await store().getState().selectChat(chat())
    commands = []
    onCommand = () => undefined
    return target
  }

  it('allows explicit retry after rejected queue admission, then resumes and accepts a new message', async () => {
    const target = await install()
    const executionId = nativeToolCallId(target.target)
    const result = { success: true, output: {}, logs: [] }
    let attempts = 0
    onWorkflow = (id) => {
      expect(id).toBe('original-workflow/queue')
      return ++attempts === 1
        ? json({ error: 'Queue is full', code: 'PENDING_EXECUTION_LIMIT' }, 429)
        : json({ taskId: executionId, executionId }, 202)
    }
    const fetchCopilot = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === `/api/jobs/${executionId}`
          ? Promise.resolve(
              eventResponse([
                {
                  type: 'execution:completed',
                  executionId,
                  workflowId: 'original-workflow',
                  timestamp: at,
                  eventId: 1,
                  data: { result },
                },
              ])
            )
          : fetchCopilot(input, init)
      )
    )
    tools.runWorkflow.mockImplementation(({ workflowId, native, signal }) =>
      runQueuedWorkflowExecution({
        workflowId,
        executionId: nativeToolCallId(native.target),
        native,
        signal,
        triggerType: 'manual',
        executionTarget: 'live',
      })
    )
    await store().getState().executeCopilotToolCall(executionId)
    expect(store().getState().toolCallsById[executionId]).toMatchObject({
      state: ClientToolCallState.pending,
      pending: target,
    })
    expect(store().getState().error).toBe('Queue is full')
    expect(commands).toEqual([])
    expect(attempts).toBe(1)

    await store().getState().executeCopilotToolCall(executionId)
    expect(attempts).toBe(2)
    expect(commands.filter((request) => request.command === 'tool.execute')).toEqual([
      { command: 'tool.execute', workspaceId, target: target.target, action: 'readback' },
    ])
    expect(isCopilotBusy(store().getState())).toBe(false)
    expect(await store().getState().sendMessage('Continue')).toBe(true)
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    expect(commands.some((request) => request.command === 'cancel')).toBe(false)
  })

  it('keeps Run available after a local busy refusal and admits one later explicit attempt', async () => {
    const target = await install()
    useExecutionStore.getState().setIsExecuting(true)
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(tools.runWorkflow).not.toHaveBeenCalled()
    expect(commands).toEqual([])
    expect(store().getState().toolCallsById[nativeToolCallId(target.target)]).toMatchObject({
      state: ClientToolCallState.pending,
      pending: target,
    })
    expect(store().getState().error).toContain('Try again later')
    expect(store().getState().isAwaitingContinuation).toBe(true)

    useExecutionStore.getState().setIsExecuting(false)
    const admitted = defer<{
      success: boolean
      output: Record<string, unknown>
      logs: unknown[]
    }>()
    tools.runWorkflow.mockReturnValue(admitted.promise)
    const retry = store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    await vi.waitFor(() => expect(tools.runWorkflow).toHaveBeenCalledOnce())
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(tools.runWorkflow).toHaveBeenCalledOnce()
    admitted.resolve({ success: true, output: {}, logs: [] })
    await retry
    expect(tools.runWorkflow).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workflowId: 'original-workflow',
        triggerBlockId: 'original-trigger',
        native: { workspaceId, target: target.target },
      })
    )
    expect(commands.filter((request) => request.command === 'tool.execute')).toEqual([
      { command: 'tool.execute', workspaceId, target: target.target, action: 'readback' },
    ])
  })

  it('keeps automatic replay blocked after a proven local refusal under full access', async () => {
    tools.actualRunWorkflow = true
    useExecutionStore.getState().setIsExecuting(true)
    store().setState({ accessLevel: 'full' })
    const target = item()
    const other = { ...pending(), target: { ...pending().target, toolCallId: 'other' } }
    onCommand = (request) => {
      if (request.command === 'message')
        return acceptTurn(suspended([target, other]), [
          {
            type: 'tool.display',
            toolName: target.target.toolName,
            toolCallId: target.target.toolCallId,
            args: target.originalArgs,
          },
        ])
      if (request.command === 'tool.execute' && request.target.toolCallId === 'other')
        return acceptTurn(suspended([target]))
    }
    await store().getState().sendMessage('Run the workflow')
    await vi.waitFor(() => expect(store().getState().error).toContain('Try again later'))
    expect(tools.runWorkflow).not.toHaveBeenCalled()
    useExecutionStore.getState().setIsExecuting(false)
    await store().getState().executeCopilotToolCall('other')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(tools.runWorkflow).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(tools.runWorkflow).toHaveBeenCalledOnce()
  })

  it.each(['transport', 'readback'] as const)(
    'retains replay protection after entering execution with an uncertain %s outcome',
    async (failure) => {
      const target = await install()
      if (failure === 'transport')
        tools.runWorkflow.mockRejectedValue(new Error('Execution response unavailable'))
      onCommand = (request) =>
        request.command === 'tool.execute'
          ? json(
              { status: 'refused', error: { code: 'STALE_TARGET', message: 'Readback failed' } },
              409
            )
          : undefined
      await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
      expect(tools.runWorkflow).toHaveBeenCalledOnce()
      expect(store().getState().toolCallsById[nativeToolCallId(target.target)]).toMatchObject({
        state: ClientToolCallState.error,
        pending: target,
      })
      await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
      expect(tools.runWorkflow).toHaveBeenCalledOnce()
      expect(store().getState().error).toContain('already attempted')
    }
  )

  it('does not infer a safe retry from restored Pending after an uncertain execution', async () => {
    const target = await install()
    tools.runWorkflow.mockRejectedValue(new Error('Execution response unavailable'))
    onCommand = (request) => {
      if (request.command === 'thread.observe') return historyResponse([target])
      if (request.command === 'cancel')
        return json(
          { status: 'failed', error: { code: 'FAILED', message: 'Cancellation refused' } },
          503
        )
    }
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(tools.runWorkflow).toHaveBeenCalledOnce()
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[nativeToolCallId(target.target)]).toMatchObject({
      state: ClientToolCallState.pending,
      pending: target,
      historyOrigin: true,
    })
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(tools.runWorkflow).toHaveBeenCalledOnce()
    expect(store().getState().error).toContain('already attempted')
  })
})

describe('explicit OAuth popup activation', () => {
  const item = (): Pending => ({
    ...pending('result', 'oauth_request_access'),
    originalArgs: { providerName: 'Google Drive' },
    context: { workspaceId: 'chosen-business' },
  })
  const install = async () => {
    const target = item()
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([target]) : undefined
    await store().getState().selectChat(chat())
    onCommand = () => undefined
    return target
  }
  const popup = () => ({
    closed: false,
    opener: {} as unknown,
    location: { replace: vi.fn() },
    close: vi.fn(),
  })
  const installWindow = (open: ReturnType<typeof vi.fn>) => {
    tools.actualOAuth = true
    vi.stubGlobal('window', { open, location: { origin: 'https://studio.example' } })
  }
  const workspaceResponse = (response: () => Promise<Response>) => {
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url) === '/api/workspaces' ? response() : original(url, init)
    )
  }
  it('never automatically opens OAuth under full access', async () => {
    const open = vi.fn().mockReturnValue(null)
    installWindow(open)
    workspaceResponse(async () => json({ workspaces: [{ id: 'chosen-business' }] }))
    store().setState({ accessLevel: 'full' })
    const target = item()
    onCommand = (request) =>
      request.command === 'message'
        ? acceptTurn(suspended([target]))
        : request.command === 'thread.observe'
          ? historyResponse([target])
          : undefined
    await store().getState().sendMessage('Connect Google Drive')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(open).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/workspaces')).toBe(false)
    expect(store().getState().isAwaitingContinuation).toBe(true)
  })
  it('reserves an isolated window on the click before waiting for fresh workspace authorization', async () => {
    const target = await install()
    const opened = popup()
    const open = vi.fn().mockReturnValue(opened)
    installWindow(open)
    const authorized = defer<Response>()
    workspaceResponse(() => authorized.promise)
    const connecting = store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank')
    expect(opened.opener).toBeNull()
    expect(opened.location.replace).not.toHaveBeenCalled()
    authorized.resolve(json({ workspaces: [{ id: 'chosen-business' }] }))
    await connecting
    expect(opened.location.replace).toHaveBeenCalledExactlyOnceWith(
      'https://studio.example/workspace/chosen-business/integrations?connect=google-drive'
    )
    expect(opened.close).not.toHaveBeenCalled()
    expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(1)
  })
  it('allows a blocked Connect retry but does not replay an opened window after acknowledgement failure', async () => {
    const target = await install()
    const opened = popup()
    const open = vi.fn().mockReturnValueOnce(null).mockReturnValue(opened)
    installWindow(open)
    workspaceResponse(async () => json({ workspaces: [{ id: 'chosen-business' }] }))
    onCommand = (request) =>
      request.command === 'tool.result'
        ? json({ status: 'refused', error: { code: 'STALE_TARGET', message: 'Ack failed' } }, 409)
        : undefined
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(open).toHaveBeenCalledOnce()
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(open).toHaveBeenCalledTimes(2)
    expect(opened.location.replace).toHaveBeenCalledOnce()
    expect(store().getState().toolCallsById[nativeToolCallId(target.target)].result).toMatchObject({
      opened: true,
    })
    unregisterClientTool(nativeToolCallId(target.target))
    await store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
    expect(open).toHaveBeenCalledTimes(2)
    expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(1)
    expect(store().getState().isAwaitingContinuation).toBe(true)
  })
  it.each(['revoked', 'navigation'] as const)(
    'closes the reserved window without navigation after %s authorization',
    async (change) => {
      const target = await install()
      const opened = popup()
      installWindow(vi.fn().mockReturnValue(opened))
      const authorized = defer<Response>()
      workspaceResponse(() => authorized.promise)
      const connecting = store().getState().executeCopilotToolCall(nativeToolCallId(target.target))
      await vi.waitFor(() =>
        expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/workspaces')).toBe(true)
      )
      if (change === 'navigation') await store().getState().createNewChat()
      authorized.resolve(
        json({ workspaces: change === 'revoked' ? [] : [{ id: 'chosen-business' }] })
      )
      await connecting
      expect(opened.close).toHaveBeenCalled()
      expect(opened.location.replace).not.toHaveBeenCalled()
      expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
    }
  )
})

describe('R5 reopened OAuth workspace authorization', () => {
  const oauth = (scope: string | null = null) => ({
    ...pending('result', 'oauth_request_access'),
    originalArgs: { providerName: 'Google Drive' },
  })
  let allowed: Array<{ id: string; name: string }>
  async function reopen(item = oauth()) {
    allowed = [
      { id: 'chosen-business', name: 'Chosen business' },
      { id: 'original-entity-workspace', name: 'Original business' },
    ]
    onCommand = (request) => {
      if (request.command === 'thread.observe') return historyResponse([item])
      if (request.command === 'tool.approve') {
        item.stage = 'result'
        return acceptTurn(suspended([item]))
      }
      return undefined
    }
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url) === '/api/workspaces'
        ? Promise.resolve(json({ workspaces: allowed }))
        : original(url, init)
    )
    await store().getState().selectChat(chat(null))
    return item
  }
  it('preserves a reopened personal Pending and permits an explicit choice after a proved missing-context refusal', async () => {
    const item = await reopen()
    expect(
      store().getState().toolCallsById[nativeToolCallId(item.target)].provenance
    ).toBeUndefined()
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().error).toContain('Choose an authorized workspace')
    await store()
      .getState()
      .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    tools.browser.mockImplementationOnce(async () => {
      store().setState((state) => ({
        toolCallsById: {
          ...state.toolCallsById,
          [nativeToolCallId(item.target)]: {
            ...state.toolCallsById[nativeToolCallId(item.target)],
            result: { opened: true, surface: 'integrations' },
          },
        },
      }))
    })
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith(item.originalArgs)
    expect(tools.bind).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'chosen-business' })
    )
    const call = store().getState().toolCallsById[nativeToolCallId(item.target)]
    expect(call.pending).toEqual(item)
    expect(call.params).toEqual({ providerName: 'Google Drive' })
    expect(store().getState().currentChat?.workspaceId).toBeNull()
    expect(store().getState().conversationWorkspaceId).toBeNull()
    const block = store()
      .getState()
      .messages.flatMap((message) => message.contentBlocks ?? [])
      .find(
        (part) => part.type === 'tool_call' && part.toolCall.id === nativeToolCallId(item.target)
      )
    expect(block?.type === 'tool_call' && block.toolCall.provenance).toEqual(call.provenance)
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).toHaveBeenCalledTimes(1)
    expect(commands.some((request) => request.command === 'message')).toBe(false)
  })
  it('requires native approval before choosing, then authorizes the distinct business workspace', async () => {
    const item = oauth()
    item.stage = 'approval'
    await reopen(item)
    await expect(
      store().getState().authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    ).rejects.toThrow('Native approval')
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(commands.filter((request) => request.command === 'tool.approve')).toHaveLength(1)
    expect(tools.browser).not.toHaveBeenCalled()
    await store()
      .getState()
      .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith({ providerName: 'Google Drive' })
    expect(store().getState().currentChat?.workspaceId).toBeNull()
  })
  it('requires an explicit business workspace when a reopened OAuth card has no workspace', async () => {
    const item = await reopen()
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [nativeToolCallId(item.target)]: {
          ...state.toolCallsById[nativeToolCallId(item.target)],
          provenance: { contextEntityKind: 'workflow', contextEntityId: 'original-workflow' },
        },
      },
    }))
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(workflowRequests).toEqual([])
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().error).toContain('Choose an authorized workspace')
  })
  it('refuses revoked or ambiguous choices before contact and retains a later explicitly authorized attempt', async () => {
    const item = await reopen()
    allowed = [
      { id: 'chosen-business', name: 'A' },
      { id: 'chosen-business', name: 'B' },
    ]
    await expect(
      store().getState().authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    ).rejects.toThrow('ambiguous')
    allowed = [{ id: 'chosen-business', name: 'Business' }]
    await store()
      .getState()
      .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    allowed = []
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).not.toHaveBeenCalled()
    allowed = [{ id: 'chosen-business', name: 'Business' }]
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).toHaveBeenCalledTimes(1)
  })
  it.each(['navigation', 'stage'] as const)(
    'refuses stale OAuth choice after %s without effects',
    async (change) => {
      const item = await reopen()
      const held = defer<Response>()
      const original = vi.mocked(fetch).getMockImplementation()!
      vi.mocked(fetch).mockImplementation((url, init) =>
        String(url) === '/api/workspaces' ? held.promise : original(url, init)
      )
      const choice = store()
        .getState()
        .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
      const outcome = expect(choice).rejects.toThrow('selection changed')
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces'))
      if (change === 'navigation') store().getState().createNewChat()
      else
        store().setState((state) => ({
          toolCallsById: {
            ...state.toolCallsById,
            [nativeToolCallId(item.target)]: {
              ...state.toolCallsById[nativeToolCallId(item.target)],
              pending: { ...item, stage: 'approval' },
            },
          },
        }))
      held.resolve(json({ workspaces: allowed }))
      await outcome
      expect(tools.browser).not.toHaveBeenCalled()
    }
  )
  it('keeps a known opened fact and refuses replay after acknowledgement failure', async () => {
    const item = await reopen()
    await store()
      .getState()
      .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    tools.browser.mockImplementation(async () => {
      store().setState((state) => ({
        toolCallsById: {
          ...state.toolCallsById,
          [nativeToolCallId(item.target)]: {
            ...state.toolCallsById[nativeToolCallId(item.target)],
            result: { opened: true, surface: 'integrations' },
          },
        },
      }))
      throw new Error('native acknowledgement failed')
    })
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).toHaveBeenCalledTimes(1)
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].result).toMatchObject({
      opened: true,
    })
  })
})

describe('R5 per-tool context at actual live call creation', () => {
  it.each(
    (['display', 'terminal'] as const).flatMap((order) =>
      [0, 1].map((index) => [order, index] as const)
    )
  )(
    'pins dashboard A and ordinary watchlist B through %s, executing tool%s at the actual server boundary',
    async (order, selectedIndex) => {
      setChat()
      const layout = {
        ...pending('approval', 'read_layout'),
        target: { ...pending().target, toolCallId: 'layout-call', toolName: 'read_layout' },
        originalArgs: { entityId: 'dashboard-a' },
        context: {
          contextEntityKind: 'dashboard_layout' as const,
          contextEntityId: 'dashboard-a',
          workspaceId: 'workspace-a',
        },
      }
      const watchlist = {
        ...pending('approval', 'read_watchlist'),
        target: { ...pending().target, toolCallId: 'watchlist-call', toolName: 'read_watchlist' },
        originalArgs: { entityId: 'watchlist-b' },
        context: {
          contextEntityKind: 'watchlist' as const,
          contextEntityId: 'watchlist-b',
          workspaceId: 'workspace-b',
        },
      }
      const items = [layout, watchlist]
      onCommand = (request) => {
        if (request.command === 'thread.observe') return historyResponse(items)
        if (request.command === 'message') {
          if (order === 'terminal') return acceptTurn(suspended(items))
          const displays = items.map((item) => ({
            type: 'tool.display',
            toolCallId: item.target.toolCallId,
            toolName: item.target.toolName,
          }))
          return acceptTurn(suspended(items), displays)
        }
        return undefined
      }
      expect(
        await store()
          .getState()
          .sendMessage('read both', {
            contexts: [
              buildCopilotWorkspaceEntityContext({
                entityKind: 'watchlist',
                entityId: 'watchlist-b',
                workspaceId: 'workspace-b',
                label: 'Explicit B',
              }),
            ],
            runtimeContext: {
              workspaceId: 'workspace-a',
              implicitContexts: [
                {
                  kind: 'current_dashboard_layout',
                  dashboardLayoutId: 'dashboard-a',
                  workspaceId: 'workspace-a',
                  ownerUserId: actorUserId,
                  label: 'Dashboard A',
                },
              ],
            },
          })
      ).toBe(true)
      const expected = [
        {
          contextEntityKind: 'dashboard_layout',
          contextEntityId: 'dashboard-a',
          workspaceId: 'workspace-a',
        },
        {
          contextEntityKind: 'watchlist',
          contextEntityId: 'watchlist-b',
          workspaceId: 'workspace-b',
        },
      ]
      for (const [index, item] of items.entries()) {
        const call = store().getState().toolCallsById[nativeToolCallId(item.target)]
        expect(call.provenance).toEqual(expected[index])
        const block = store()
          .getState()
          .messages.flatMap((message) => message.contentBlocks ?? [])
          .find(
            (part) =>
              part.type === 'tool_call' && part.toolCall.id === nativeToolCallId(item.target)
          )
        expect(block?.type === 'tool_call' && block.toolCall.provenance).toEqual(expected[index])
        const unchanged = applyNativeEvent(
          store().getState(),
          {
            type: 'tool.display',
            toolCallId: item.target.toolCallId,
            toolName: item.target.toolName,
          },
          'unused'
        )
        expect(unchanged).toEqual({})
      }
      const item = items[selectedIndex]
      item.stage = 'result'
      store().setState((state) => displayNativePending(state, item))
      await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
      expect(commands.find((request) => request.command === 'tool.execute')).toMatchObject({
        workspaceId,
        target: item.target,
        context: expected[selectedIndex],
      })
      expect(store().getState().conversationWorkspaceId).toBe(workspaceId)
    }
  )
})

describe('selected native run context', () => {
  it.each([true, false])(
    'restores conversation B context after A, including new review cards (context present: %s)',
    async (hasContext) => {
      setChat()
      expect(
        await store()
          .getState()
          .sendMessage('A', {
            contexts: [
              buildCopilotWorkspaceEntityContext({
                entityKind: 'workflow',
                entityId: 'workflow-A',
                workspaceId,
                label: 'A',
              }),
            ],
            runtimeContext: { workspaceId, implicitContexts: [] },
          })
      ).toBe(true)
      const b = chat(workspaceId, 'thread-B')
      const context = hasContext
        ? {
            contextEntityKind: 'workflow' as const,
            contextEntityId: 'workflow-B',
            workspaceId,
          }
        : undefined
      const first: Pending = {
        target: {
          threadId: b.threadId,
          resourceId: 'resource-B',
          runId: 'run-B',
          toolCallId: 'request-B',
          toolName: 'make_api_request',
        },
        stage: 'approval',
        originalArgs: { url: 'https://example.com', method: 'GET' },
        context,
      }
      const next: Pending = {
        target: { ...first.target, toolCallId: 'layout-B', toolName: 'create_layout' },
        stage: 'result',
        originalArgs: { workspaceId, name: 'New layout' },
        preview: { requiresReview: true, success: true },
        context,
      }
      let continued = false
      onCommand = (request) => {
        if (request.command === 'thread.observe')
          return observingStream(historyResult([], continued ? [next] : [first], b.threadId))
            .response
        if (request.command === 'tool.approve') {
          continued = true
          return acceptTurn(
            {
              status: 'suspended',
              threadId: b.threadId,
              runId: first.target.runId,
              text: '',
              pending: [next],
            },
            [
              {
                type: 'tool.display',
                toolCallId: next.target.toolCallId,
                toolName: next.target.toolName,
              },
            ]
          )
        }
        if (request.command === 'tool.execute')
          return acceptTurn({
            status: 'completed',
            threadId: b.threadId,
            runId: first.target.runId,
            text: 'Done',
          })
      }
      await store().getState().selectChat(b)
      expect(store().getState().toolCallsById[nativeToolCallId(first.target)].provenance).toEqual(
        context
      )
      await store().getState().executeCopilotToolCall(nativeToolCallId(first.target))
      expect(store().getState().toolCallsById[nativeToolCallId(next.target)].provenance).toEqual(
        context
      )
      await store().getState().executeCopilotToolCall(nativeToolCallId(next.target))
      const accepted = commands.find((request) => request.command === 'tool.execute')
      expect(accepted).toMatchObject({
        command: 'tool.execute',
        target: next.target,
        action: 'review.accept',
      })
      expect(accepted && 'context' in accepted ? accepted.context : undefined).toEqual(context)
      expect(store().getState().error).toBeNull()
    }
  )

  it('binds a cold browser tool to its native run workspace', async () => {
    const item: Pending = {
      ...pending('result', 'deploy_workflow'),
      originalArgs: { action: 'deploy', deployType: 'chat', entityId: 'workflow-B' },
      context: {
        workspaceId: 'workspace-B',
        contextEntityKind: 'workflow',
        contextEntityId: 'workflow-B',
      },
    }
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith(item.originalArgs)
    expect(tools.bind).toHaveBeenLastCalledWith({ workspaceId: item.context?.workspaceId })
  })

  it('keeps an explicit OAuth workspace choice through native history refresh', async () => {
    const item: Pending = {
      ...pending('result', 'oauth_request_access'),
      originalArgs: { providerName: 'Google Drive' },
      context: { contextEntityKind: 'workflow', contextEntityId: 'workflow-B' },
    }
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url) === '/api/workspaces'
        ? Promise.resolve(json({ workspaces: [{ id: 'chosen-business' }] }))
        : original(url, init)
    )
    await store().getState().selectChat(chat(null))
    await store()
      .getState()
      .authorizeToolWorkspace(nativeToolCallId(item.target), 'chosen-business')
    await reconnectSelectedChat()
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].provenance).toEqual({
      ...item.context,
      workspaceId: 'chosen-business',
    })
  })
})

describe('owned workflow chat deployment UI', () => {
  const prepareChatDeployment = () => {
    const item: Pending = {
      ...pending('result', 'deploy_workflow'),
      originalArgs: { action: 'deploy', deployType: 'chat', entityId: 'target-a' },
    }
    installPending(item)
    store().setState({ currentChat: chat(null), conversationWorkspaceId: null })
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    return item
  }
  const open = () =>
    store().getState().openWorkflowChatDeployment(nativeToolCallId(pending().target), {
      workflowId: 'target-a',
      workspaceId: 'original-entity-workspace',
    })

  it('awaits the target form and records known opened before resolving, without changing tool scope', async () => {
    const item = prepareChatDeployment()
    const original = structuredClone(item)
    let completed = false
    const operation = open().then(() => {
      completed = true
    })
    await vi.waitFor(() => expect(store().getState().workflowChatDeployment).not.toBeNull())
    const request = store().getState().workflowChatDeployment!
    expect(request).toMatchObject({
      toolCallId: nativeToolCallId(item.target),
      workflowId: 'target-a',
      workspaceId: 'original-entity-workspace',
      opened: false,
    })
    expect(request.isCurrent()).toBe(true)
    expect(completed).toBe(false)
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].result).toBeUndefined()
    store().getState().settleWorkflowChatDeployment(request.id, 'opened')
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].result).toEqual({
      opened: true,
      surface: 'chat-deployment',
      message: 'Opened chat deployment settings',
    })
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].state).toBe(
      ClientToolCallState.executing
    )
    await operation
    expect(completed).toBe(true)
    expect(item).toEqual(original)
    expect(store().getState().currentChat?.workspaceId).toBeNull()
    expect(commands.filter((request) => request.command === 'tool.result')).toEqual([])
    expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
    store().getState().settleWorkflowChatDeployment(request.id, 'closed')
  })

  it('keeps a rendered dialog across normal native ACK replacing the business signal and consuming Pending', async () => {
    const item = prepareChatDeployment()
    const business = new AbortController()
    store().setState({ abortController: business })
    const operation = open()
    await vi.waitFor(() => expect(store().getState().workflowChatDeployment).not.toBeNull())
    const request = store().getState().workflowChatDeployment!
    store().getState().settleWorkflowChatDeployment(request.id, 'opened')
    await operation
    await store()
      .getState()
      .submitBrowserAssertion(nativeToolCallId(item.target), {
        kind: 'ui.opened',
        data: {
          opened: true,
          surface: 'chat-deployment',
          message: 'Opened chat deployment settings',
        },
      })
    expect(business.signal.aborted).toBe(true)
    expect(store().getState().workflowChatDeployment?.opened).toBe(true)
    expect(store().getState().workflowChatDeployment?.isCurrent()).toBe(true)
    expect(commands.filter((value) => value.command === 'tool.result')).toHaveLength(1)
    store().getState().settleWorkflowChatDeployment(request.id, 'closed')
  })

  it.each(['closed', 'error'] as const)(
    'refuses %s before a rendered UI without fabricating an opened result',
    async (outcome) => {
      prepareChatDeployment()
      const operation = open()
      const refused = expect(operation).rejects.toThrow('No target form rendered')
      await vi.waitFor(() => expect(store().getState().workflowChatDeployment).not.toBeNull())
      const id = store().getState().workflowChatDeployment!.id
      store().getState().settleWorkflowChatDeployment(id, outcome, 'No target form rendered')
      await refused
      expect(store().getState().workflowChatDeployment).toBeNull()
      expect(
        store().getState().toolCallsById[nativeToolCallId(pending().target)].result
      ).toBeUndefined()
    }
  )

  it('refuses a stale Pending change before a late rendered notification', async () => {
    const item = prepareChatDeployment()
    const operation = open()
    const refused = expect(operation).rejects.toThrow('closed before rendering')
    await vi.waitFor(() => expect(store().getState().workflowChatDeployment).not.toBeNull())
    const request = store().getState().workflowChatDeployment!
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [nativeToolCallId(item.target)]: {
          ...state.toolCallsById[nativeToolCallId(item.target)],
          pending: { ...item, stage: 'approval' },
        },
      },
    }))
    expect(request.isCurrent()).toBe(false)
    store().getState().settleWorkflowChatDeployment(request.id, 'opened')
    await refused
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].result).toBeUndefined()
  })

  it.each(['approval', 'foreign-workspace', 'wrong-workflow', 'denied'] as const)(
    'refuses %s before creating a UI request',
    async (kind) => {
      const item = prepareChatDeployment()
      if (kind === 'approval') item.stage = 'approval'
      if (kind === 'denied') onWorkflow = () => json({ error: 'Denied' }, 403)
      const scope = {
        workflowId: kind === 'wrong-workflow' ? 'other' : 'target-a',
        workspaceId: kind === 'foreign-workspace' ? 'foreign' : 'original-entity-workspace',
      }
      await expect(
        store().getState().openWorkflowChatDeployment(nativeToolCallId(item.target), scope)
      ).rejects.toThrow()
      expect(store().getState().workflowChatDeployment).toBeNull()
      expect(commands.filter((value) => value.command === 'tool.result')).toEqual([])
    }
  )

  it('closes an unrendered request on actual owner cancellation and ignores its late notification', async () => {
    prepareChatDeployment()
    const operation = open()
    const refused = expect(operation).rejects.toThrow('selection changed')
    await vi.waitFor(() => expect(store().getState().workflowChatDeployment).not.toBeNull())
    const id = store().getState().workflowChatDeployment!.id
    store().getState().abortMessage()
    await refused
    store().getState().settleWorkflowChatDeployment(id, 'opened')
    expect(store().getState().workflowChatDeployment).toBeNull()
    expect(
      store().getState().toolCallsById[nativeToolCallId(pending().target)].result
    ).toBeUndefined()
  })
})

describe('built-in tool continuation', () => {
  it.each(['stream', 'reconnect', 'initial-history', 'reconnect-before-display'])(
    'automatically executes a submitted browser tool once after suspension (%s)',
    async (delivery) => {
      const originalArgs = { seconds: 0 }
      const item = { ...pending('result', 'sleep'), originalArgs }
      const generation =
        delivery === 'initial-history'
          ? observingStream(pendingHistory([item]))
          : outputStream(
              delivery === 'reconnect-before-display'
                ? []
                : [
                    {
                      type: 'tool.display',
                      toolCallId: item.target.toolCallId,
                      toolName: 'sleep',
                      args: originalArgs,
                    },
                  ]
            )
      setChat()
      onCommand = (request) =>
        request.command === 'message' ? acceptObservation(generation.response) : undefined
      let observations = 0
      onObserve = () => (++observations === 1 ? generation.response : historyResponse([item]))
      const sending = store().getState().sendMessage('Continue')
      if (delivery !== 'initial-history') {
        await vi.waitFor(() => expect(observations).toBe(1))
        if (delivery !== 'reconnect-before-display')
          await vi.waitFor(() =>
            expect(store().getState().toolCallsById[nativeToolCallId(item.target)]?.state).toBe(
              ClientToolCallState.generating
            )
          )
        if (delivery === 'stream')
          generation.emit({
            type: 'thread.status',
            runId,
            status: 'suspended',
            history: pendingHistory([item]),
          })
        else generation.fail(new Error('Connection lost before suspension'))
      }
      expect(await sending).toBe(true)
      await vi.waitFor(() => expect(tools.browser).toHaveBeenCalledExactlyOnceWith(originalArgs))
      const call = store().getState().toolCallsById[nativeToolCallId(item.target)]
      expect(call.historical).toBe(false)
      expect(call.historyOrigin).toBeUndefined()
      const part = store()
        .getState()
        .messages.flatMap((message) => message.contentBlocks ?? [])
        .find(
          (block) =>
            block.type === 'tool_call' && block.toolCall.id === nativeToolCallId(item.target)
        )
      expect(part?.type === 'tool_call' && part.toolCall).toBe(call)
      await reconnectSelectedChat()
      await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
      expect(tools.browser).toHaveBeenCalledTimes(1)
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
      expect(commands.filter((request) => request.command === 'thread.observe')).toHaveLength(
        delivery.startsWith('reconnect') ? 3 : 2
      )
    }
  )

  it('keeps a reopened browser invocation ineligible through repeated history refreshes', async () => {
    const item = { ...pending('result', 'sleep'), originalArgs: { seconds: 0 } }
    onCommand = (request) =>
      request.command === 'thread.observe' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].historyOrigin).toBe(true)
    await reconnectSelectedChat()
    expect(await store().getState().sendMessage('Continue')).toBe(false)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].historyOrigin).toBe(true)
  })

  it.each([
    { state: ClientToolCallState.executing, result: undefined },
    { state: ClientToolCallState.error, result: { success: true, seconds: 0 } },
  ])('preserves live $state state when history has no matching invocation', async (live) => {
    const item = {
      ...pending('result', 'sleep'),
      originalArgs: { seconds: 0 },
      context: { workspaceId: 'pinned-workspace' },
    }
    installPending(item)
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [nativeToolCallId(item.target)]: {
          ...state.toolCallsById[nativeToolCallId(item.target)],
          ...live,
          provenance: { workspaceId: 'pinned-workspace' },
        },
      },
    }))
    onCommand = (request) =>
      request.command === 'thread.observe'
        ? observingStream(historyResult(history, [item])).response
        : undefined
    await reconnectSelectedChat()
    const call = store().getState().toolCallsById[nativeToolCallId(item.target)]
    expect(call).toMatchObject({ ...live, provenance: { workspaceId: 'pinned-workspace' } })
    expect(call.pending).toEqual(item)
    expect(call.historyOrigin).toBeUndefined()
    expect(tools.browser).not.toHaveBeenCalled()
  })

  it('never autoexecutes a cold pending tool omitted from history after another tool continues', async () => {
    const cold = { ...pending('result', 'sleep'), originalArgs: { seconds: 0 } }
    const other = {
      ...cold,
      target: { ...cold.target, toolCallId: 'other-call' },
    }
    let items = [other, cold]
    onCommand = (request) => {
      if (request.command === 'thread.observe')
        return observingStream(historyResult(history, items)).response
      if (request.command === 'tool.result') {
        items = [cold]
        return acceptTurn(suspended(items))
      }
      return undefined
    }
    await store().getState().selectChat(chat())
    await store()
      .getState()
      .submitBrowserAssertion(nativeToolCallId(other.target), {
        kind: 'timer.completed',
        data: { success: true, seconds: 0 },
      })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[nativeToolCallId(cold.target)].historyOrigin).toBe(true)
  })

  it.each(['runId', 'resourceId', 'toolName', 'originalArgs', 'context'] as const)(
    'does not transfer live origin when authoritative pending %s changes',
    async (field) => {
      const item = { ...pending('result', 'sleep'), originalArgs: { seconds: 0 } }
      const changed: Pending = structuredClone(item)
      if (field === 'originalArgs') changed.originalArgs = { seconds: 1 }
      else if (field === 'context') changed.context = { workspaceId: 'changed-workspace' }
      else if (field === 'toolName') {
        changed.target.toolName = 'run_workflow'
        changed.originalArgs = { entityId: 'workflow-fixture' }
      } else changed.target[field] = 'changed'
      installPending(item)
      onCommand = (request) =>
        request.command === 'thread.observe' ? historyResponse([changed]) : undefined
      await reconnectSelectedChat()
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(tools.browser).not.toHaveBeenCalled()
      const call = store().getState().toolCallsById[nativeToolCallId(changed.target)]
      expect(call.pending).toEqual(changed)
      expect(call.historyOrigin).toBe(true)
      expect(call.provenance).toEqual(changed.context)
    }
  )

  it.each(['limited', 'full'] as const)(
    'never automatically accepts a persisted preview under %s access',
    async (accessLevel) => {
      const item = pending('result', 'edit_workflow')
      item.preview = { requiresReview: true }
      store().setState({ conversationWorkspaceId: workspaceId, accessLevel })
      onCommand = (request) =>
        request.command === 'message'
          ? acceptTurn(suspended([item]))
          : request.command === 'thread.observe'
            ? historyResponse([item])
            : undefined
      expect(await store().getState().sendMessage('Prepare edit')).toBe(true)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(store().getState().toolCallsById[nativeToolCallId(item.target)]).toMatchObject({
        state: 'review',
        result: item.preview,
      })
      expect(
        commands.some(
          (request) => request.command === 'tool.execute' || request.command === 'tool.approve'
        )
      ).toBe(false)
    }
  )
  it('rejects a preview through one local decision while preserving other pending work', async () => {
    const item = pending('result', 'edit_workflow')
    item.preview = { requiresReview: true }
    const other = { ...pending('approval'), target: { ...pending().target, toolCallId: 'other' } }
    installPending(item)
    onCommand = (request) =>
      request.command === 'thread.observe'
        ? historyResponse([item, other])
        : request.command === 'tool.execute'
          ? acceptTurn(suspended([other]))
          : undefined
    await store().getState().readPendingTool(nativeToolCallId(item.target))
    await store().getState().skipCopilotToolCall(nativeToolCallId(item.target))
    expect(commands.find((request) => request.command === 'tool.execute')).toMatchObject({
      target: item.target,
      action: 'review.reject',
    })
    expect(
      commands.some((request) => request.command === 'tool.result' || request.command === 'cancel')
    ).toBe(false)
    expect(store().getState().isAwaitingContinuation).toBe(true)
  })
  it('an initial action that discovers a new preview never accepts it implicitly', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    const fresh = { ...item, preview: { requiresReview: true, description: 'later preview' } }
    onCommand = (request) =>
      request.command === 'tool.execute'
        ? acceptTurn(suspended([fresh]))
        : request.command === 'thread.observe'
          ? historyResponse([fresh])
          : undefined
    await store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    expect(commands.filter((request) => request.command === 'tool.execute')).toEqual([
      expect.objectContaining({ action: 'execute', target: item.target }),
    ])
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].state).toBe('review')
  })
  it('a concurrent rejection cannot claim success while acceptance is in flight', async () => {
    const item = pending('result', 'edit_workflow')
    item.preview = { requiresReview: true }
    installPending(item)
    const gate = defer<Response>()
    onCommand = (request) =>
      request.command === 'thread.observe'
        ? historyResponse([item])
        : request.command === 'tool.execute'
          ? gate.promise
          : undefined
    await store().getState().readPendingTool(nativeToolCallId(item.target))
    const active = store().getState().executeCopilotToolCall(nativeToolCallId(item.target))
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(true)
    )
    await expect(
      store().getState().skipCopilotToolCall(nativeToolCallId(item.target))
    ).rejects.toThrow('already in flight')
    gate.resolve(acceptTurn(ready()))
    await active
    expect(commands.filter((request) => request.command === 'tool.execute')).toHaveLength(1)
  })
  it('renders authoritative automatic tool results without a browser round trip', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? acceptTurn(ready(), [
            {
              type: 'tool.display',
              toolCallId: 'automatic',
              toolName: 'search_online',
            },
            {
              type: 'tool.result',
              toolCallId: 'automatic',
              toolName: 'search_online',
              result: { results: [] },
            },
          ])
        : undefined
    expect(await store().getState().sendMessage('Search')).toBe(true)
    expect(tools.refresh).toHaveBeenCalledWith('search_online', { results: [] })
    expect(
      commands.some(
        (request) => request.command === 'tool.execute' || request.command === 'tool.result'
      )
    ).toBe(false)
  })
  it.each(['live', 'history', 'status'])(
    'refreshes %s mutations once per native call in their actual workspace',
    async (source) => {
      const result = { success: true, workspaceId: 'actual-business-workspace' }
      let nativeRunId = runId
      const invocation = { toolCallId: 'mutation', toolName: 'edit_monitor', result }
      const saved = () => toolHistory([{ state: 'result', ...invocation }], [], nativeRunId)
      let observer = observingStream(
        source === 'history' ? saved() : historyResult([history[0]]),
        runId
      )
      onObserve = () => observer.response
      await store().getState().selectChat(chat(null))
      if (source === 'live') {
        observer.emit({ type: 'thread.started', runId, messageId: history[1].id })
        observer.emit({
          type: 'thread.output',
          runId,
          event: { type: 'tool.result', ...invocation },
        })
      }
      if (source !== 'status')
        await vi.waitFor(() => expect(tools.refresh).toHaveBeenCalledTimes(1))
      observer.emit({ type: 'thread.status', runId, status: 'success', history: saved() })
      await vi.waitFor(() => expect(store().getState().currentRunId).toBeNull())
      expect(tools.refresh).toHaveBeenCalledExactlyOnceWith('edit_monitor', result)
      observer = observingStream(saved())
      await reconnectSelectedChat()
      expect(tools.refresh).toHaveBeenCalledTimes(1)
      nativeRunId = 'another-native-run'
      observer.emit({
        type: 'thread.status',
        runId: nativeRunId,
        status: 'success',
        history: saved(),
      })
      await vi.waitFor(() =>
        expect(store().getState().toolCallsById).toHaveProperty(
          nativeToolCallId({ runId: nativeRunId, toolCallId: invocation.toolCallId })
        )
      )
      expect(tools.refresh).toHaveBeenCalledTimes(2)
      expect(tools.browser).not.toHaveBeenCalled()
      expect(
        commands.some((request) => ['tool.execute', 'tool.result'].includes(request.command))
      ).toBe(false)
    }
  )
  it('does not refresh failed, denied, rejected or review-pending results recovered from history', async () => {
    const item = pending('approval', 'edit_monitor')
    item.preview = { success: true, workspaceId }
    const invocations = [
      { state: 'result', isError: true },
      { state: 'output-error' },
      { state: 'output-denied' },
      { state: 'result', result: { success: false, rejected: true, toolName: 'edit_monitor' } },
      { state: 'result', toolCallId: item.target.toolCallId, result: item.preview },
    ]
    onObserve = () =>
      observingStream(
        toolHistory(
          invocations.map((invocation, index) => ({
            toolName: 'edit_monitor',
            toolCallId: String(index),
            ...invocation,
          })),
          [item]
        )
      ).response
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[nativeToolCallId(item.target)].state).toBe(
      ClientToolCallState.review
    )
    expect(tools.refresh).not.toHaveBeenCalled()
    expect(tools.browser).not.toHaveBeenCalled()
  })
  it.each(['error', 'denied'] as const)(
    'shows %s automatic tool results without success refresh effects',
    async (outcome) => {
      setChat()
      const failed = {
        type: 'tool.result',
        toolCallId: 'failed',
        toolName: 'search_online',
        result: { error: 'Tool failed' },
        ...(outcome === 'error' ? { isError: true } : { denied: true }),
      } as const
      const projected = applyNativeEvent(
        { ...store().getState(), currentRunId: runId },
        failed,
        'assistant'
      )
      expect(
        projected.toolCallsById?.[nativeToolCallId({ runId, toolCallId: 'failed' })]
      ).toMatchObject({
        state: outcome === 'error' ? ClientToolCallState.error : ClientToolCallState.rejected,
        result: { error: 'Tool failed' },
      })
      onCommand = (request) =>
        request.command === 'message'
          ? acceptTurn(ready(), [
              {
                type: 'tool.display',
                toolCallId: 'failed',
                toolName: 'search_online',
                args: { query: 'search' },
              },
              { ...failed },
            ])
          : undefined
      expect(await store().getState().sendMessage('Search')).toBe(true)
      expect(tools.refresh).not.toHaveBeenCalled()
    }
  )
})
