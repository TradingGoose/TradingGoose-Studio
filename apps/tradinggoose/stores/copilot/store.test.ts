import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MONITOR_DOCUMENT_FORMAT } from '@/lib/copilot/monitor/monitor-documents'
import {
  COPILOT_CONTEXT_PART,
  type CopilotRequest,
  type Pending,
} from '@/lib/copilot/native/contract'
import { MAX_COPILOT_REQUEST_BYTES } from '@/lib/copilot/native/request-size'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import { useExecutionStore } from '@/stores/execution/store'
import { buildCopilotWorkspaceChannelId } from './channel-id'
import { getCopilotStore, resetCopilotStoreRegistry } from './store'
import { getCopilotStoreForToolCall } from './store-access'
import { hasUiActiveToolCalls } from './store-state'
import { applyNativeEvent, displayNativePending } from './streaming'
import type { CopilotChat } from './types'

const tools = vi.hoisted(() => ({
  actualOAuth: false,
  actualRunWorkflow: false,
  runWorkflow: vi.fn(),
  refresh: vi.fn(),
  browser: vi.fn(),
  bind: vi.fn(),
  hydrate: vi.fn(),
}))
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
        : { handleUserAction: tools.browser, hydrateToolCall: tools.hydrate },
    bindClientToolExecutionContext: (
      ...args: Parameters<typeof registry.bindClientToolExecutionContext>
    ) => {
      tools.bind(...args)
      if (tools.actualOAuth || tools.actualRunWorkflow)
        registry.bindClientToolExecutionContext(...args)
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
const terminalResponse = <T extends { status: string }>(value: T) =>
  eventResponse([
    {
      type: value.status === 'completed' ? 'response.completed' : 'response.suspended',
      result: value,
    },
  ])
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
    createdAt: at,
    parts: [{ type: 'text', text: 'canonical answer' }],
  },
]
const historyResponse = (pending: Pending[]) =>
  json({
    status: 'history',
    threadId,
    items: [
      history[0],
      {
        ...history[1],
        parts: [
          ...history[1].parts,
          ...pending.map((item) => ({
            type: 'tool-invocation',
            toolInvocation: {
              state: 'call',
              toolCallId: item.target.toolCallId,
              toolName: item.target.toolName,
              args: item.originalArgs,
            },
          })),
        ],
      },
    ],
    pending,
  })

let commands: CopilotRequest[]
let onCommand: (
  request: CopilotRequest,
  init?: RequestInit
) => Promise<Response> | Response | undefined
let onTitle: (body: any, init?: RequestInit) => Promise<Response> | Response
let titleRequests: any[]
let workflowRequests: string[]
let onWorkflow: (id: string) => Response | Promise<Response>
const store = () =>
  getCopilotStore(buildCopilotWorkspaceChannelId({ authenticatedUserId: actorUserId, workspaceId }))
const setChat = () =>
  store().setState({ currentChat: chat(), conversationWorkspaceId: workspaceId })
const installPending = (item: Pending) => {
  setChat()
  store().setState({
    currentRunId: runId,
    toolCallsById: {
      [item.target.toolCallId]: {
        id: item.target.toolCallId,
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
  if (request.command === 'history.read')
    return json({
      status: 'history',
      pending: [],
      threadId: request.threadId,
      items: history,
    })
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
  return terminalResponse(ready())
}
function eventResponse(events: object[]) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(
    events.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join('')
  )
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
beforeEach(() => {
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
      return (await onCommand(request, init)) ?? defaultResponse(request)
    })
  )
})
afterEach(() => {
  resetCopilotStoreRegistry()
  vi.unstubAllGlobals()
})

describe('canonical browser conversation transport', () => {
  it('serializes the current access level after an untitled chat history preflight settles', async () => {
    store().setState({
      currentChat: { ...chat(), title: '' },
      conversationWorkspaceId: workspaceId,
      accessLevel: 'full',
    })
    const held = defer<Response>()
    onCommand = (command) =>
      command.command === 'history.read' && commands.length === 1 ? held.promise : undefined
    const sending = store().getState().sendMessage('Describe')
    await vi.waitFor(() =>
      expect(commands.map((command) => command.command)).toEqual(['history.read'])
    )
    store().getState().setAccessLevel('limited')
    held.resolve(json({ status: 'history', threadId, items: [], pending: [] }))
    expect(await sending).toBe(true)
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

  it('uses the actual nullable conversation scope, selected model and exact input, then reads canonical history', async () => {
    store().setState({ currentChat: chat(null), selectedModel: 'openai/gpt-5.6-sol' })
    expect(
      await store()
        .getState()
        .sendMessage(' exact 🦆\n', { contexts: [{ kind: 'docs', label: 'Docs' }] })
    ).toBe(true)
    expect(commands[0]).toMatchObject({
      command: 'message',
      workspaceId: null,
      threadId,
      model: 'openai/gpt-5.6-sol',
      input: { content: ' exact 🦆\n', contexts: [{ kind: 'docs', label: 'Docs' }] },
    })
    expect(
      store()
        .getState()
        .messages.map((message) => message.id)
    ).toEqual(['user-native', 'assistant-native'])
    expect(titleRequests).toEqual([])
  })
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
    expect(store().getState().error).toBe('Copilot stream is unavailable')
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    expect(titleRequests).toEqual([])
  })
  it('preserves split UTF8, reasoning/text order and native final canonical content', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse([
            { type: 'response.started', runId, threadId },
            { type: 'reasoning.delta', text: 'thinking🦆' },
            { type: 'text.delta', text: 'preview' },
            { type: 'response.completed', result: ready() },
          ])
        : undefined
    expect(await store().getState().sendMessage('Hello')).toBe(true)
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'completed',
      text: 'canonical answer',
    })
    expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
  })
  it.each(['missing-terminal', 'raw-openai', 'trailing-data'])(
    'refuses %s streams without inventing success',
    async (mode) => {
      setChat()
      onCommand = (request) => {
        if (request.command !== 'message') return
        if (mode === 'raw-openai')
          return new Response('data: {"choices":[]}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
        const events =
          mode === 'missing-terminal'
            ? [{ type: 'text.delta', text: 'unfinished' }]
            : [
                {
                  type: 'response.completed',
                  result: {
                    ...ready(),
                  },
                },
                ...(mode === 'trailing-data' ? [{ type: 'text.delta', text: 'extra' }] : []),
              ]
        return eventResponse(events)
      }
      expect(await store().getState().sendMessage('Hello')).toBe(false)
      expect(store().getState().error).toBeTruthy()
      expect(titleRequests).toEqual([])
    }
  )
  it('preserves an explicit failed outcome instead of reporting EOF success', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse([
            { type: 'response.started', runId, threadId },
            {
              type: 'response.error',
              result: {
                status: 'failed',
                error: {
                  code: 'NATIVE_FAILURE',
                  message: 'Output failed after acceptance',
                },
              },
            },
          ])
        : undefined
    expect(await store().getState().sendMessage('Hello')).toBe(false)
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'failed',
    })
    expect(store().getState().isAwaitingContinuation).toBe(false)
    expect(titleRequests).toEqual([])
    onCommand = () => undefined
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })
  it('settles a displayed tool when cancellation follows', async () => {
    setChat()
    const item = pending('approval')
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse([
            { type: 'response.started', runId, threadId },
            {
              type: 'tool.display',
              toolCallId: item.target.toolCallId,
              toolName: item.target.toolName,
            },
            {
              type: 'response.cancel_requested',
              result: {
                status: 'cancel_requested',
                runId,
              },
            },
          ])
        : undefined
    expect(await store().getState().sendMessage('Read')).toBe(false)
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'cancel_requested',
    })
    expect(store().getState().currentRunId).toBeNull()
    expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
      state: ClientToolCallState.aborted,
      pending: undefined,
    })
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
  })
  it('settles display-only tools during a UI abort and waits for cancellation acknowledgement', async () => {
    setChat()
    const item = pending('approval')
    const acknowledgement = defer<Response>()
    let streamCancelled = false
    onCommand = (request) =>
      request.command === 'cancel'
        ? acknowledgement.promise
        : request.command === 'message'
          ? new Response(
              new ReadableStream({
                start(controller) {
                  const frames = [
                    { type: 'response.started', runId, threadId, messageId: 'canonical-live-user' },
                    {
                      type: 'tool.display',
                      toolCallId: item.target.toolCallId,
                      toolName: item.target.toolName,
                    },
                  ]
                  controller.enqueue(
                    new TextEncoder().encode(
                      frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
                    )
                  )
                },
                cancel() {
                  streamCancelled = true
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } }
            )
          : undefined
    const sending = store().getState().sendMessage('Read')
    await vi.waitFor(() =>
      expect(store().getState().toolCallsById[item.target.toolCallId]?.state).toBe(
        ClientToolCallState.generating
      )
    )
    expect(
      store()
        .getState()
        .messages.find((message) => message.role === 'user')?.id
    ).toBe('canonical-live-user')
    const stopping = store().getState().abortMessage()
    expect(store().getState().isAborting).toBe(true)
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
    expect(await store().getState().sendMessage('Wait for cancellation')).toBe(false)
    const cancel = commands.find((request) => request.command === 'cancel')!
    acknowledgement.resolve(defaultResponse(cancel))
    expect(await stopping).toBe(true)
    expect(await sending).toBe(false)
    await vi.waitFor(() =>
      expect(store().getState().lastNativeOutcome?.status).toBe('cancel_requested')
    )
    expect(streamCancelled).toBe(true)
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([
      expect.objectContaining({ threadId, runId, workspaceId }),
    ])
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'cancel_requested',
    })
    expect(store().getState().isAborting).toBe(false)
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(false)
    const call = store().getState().toolCallsById[item.target.toolCallId]
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
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    expect(store().getState().currentRunId).toBe(runId)
    expect(await store().getState().abortMessage()).toBe(true)
    expect(store().getState().lastNativeOutcome?.status).toBe('cancel_requested')
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
      let streamCancelled = false
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
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  [
                    { type: 'response.started', runId, threadId },
                    { type: 'text.delta', text: 'Still writing' },
                  ]
                    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
                    .join('')
                )
              )
            },
            cancel() {
              streamCancelled = true
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      }
      const sending = store().getState().sendMessage('Write an answer')
      await vi.waitFor(() =>
        expect(store().getState().messages.at(-1)?.content).toBe('Still writing')
      )
      expect(store().getState().isAwaitingContinuation).toBe(false)
      expect(await store().getState().abortMessage()).toBe(false)
      expect(await sending).toBe(false)
      expect(streamCancelled).toBe(true)
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
      expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
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
      request.command === 'message'
        ? terminalResponse({ ...ready(), threadId: 'other' })
        : undefined
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
    await vi.waitFor(() => expect(store().getState().lastNativeOutcome).toBeNull())
    expect(store().getState().conversationWorkspaceId).toBe('another-workspace')
  })
})

describe('failed pending continuations', () => {
  it.each(
    (['approval', 'result'] as const).flatMap((stage) =>
      ['refused', 'error', 'http', 'transport'].map((failure) => ({ stage, failure }))
    )
  )('keeps a $stage run cancellable after a $failure continuation', async ({ stage, failure }) => {
    const item = pending(stage, stage === 'approval' ? 'rename_workflow' : 'edit_workflow')
    if (stage === 'result') item.preview = { requiresReview: true }
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    commands = []
    onCommand = (request) => {
      if (request.command !== 'tool.approve' && request.command !== 'tool.execute') return
      if (failure === 'transport') throw new Error('Continuation transport failed')
      const result = {
        status: failure === 'error' ? 'failed' : 'refused',
        error: {
          code: 'STALE_TARGET',
          message: stage === 'approval' ? 'Copilot model unavailable' : 'Copilot API key removed',
        },
      }
      return failure === 'http'
        ? json(result, 409)
        : eventResponse([
            { type: failure === 'error' ? 'response.error' : 'response.refused', result },
          ])
    }

    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(store().getState()).toMatchObject({
      currentRunId: runId,
      isSendingMessage: false,
      isAwaitingContinuation: true,
    })
    expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
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
    const item = pending('approval', 'rename_workflow')
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    onCommand = (request) =>
      request.command === 'tool.approve'
        ? eventResponse([
            {
              type: 'response.refused',
              result: {
                status: 'refused',
                error: { code: 'STALE_TARGET', message: 'Copilot API key removed' },
              },
            },
          ])
        : undefined
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(store().getState().isAwaitingContinuation).toBe(true)
    await store().getState().refreshCurrentHistory()
    expect(store().getState()).toMatchObject({
      currentRunId: null,
      isAwaitingContinuation: false,
    })
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })

  it('keeps a completed continuation settled if later stream data is invalid', async () => {
    const item = pending('approval', 'rename_workflow')
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    onCommand = (request) =>
      request.command === 'tool.approve'
        ? eventResponse([
            {
              type: 'tool.result',
              toolCallId: item.target.toolCallId,
              toolName: item.target.toolName,
              result: { message: 'Renamed' },
            },
            { type: 'response.completed', result: ready() },
            { type: 'text.delta', text: 'Invalid trailing data' },
          ])
        : undefined
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(store().getState()).toMatchObject({
      currentRunId: null,
      isAwaitingContinuation: false,
      lastNativeOutcome: { status: 'completed' },
    })
    onCommand = () => undefined
    expect(await store().getState().sendMessage('Next turn')).toBe(true)
  })
})

describe('local pending approval and preview decisions', () => {
  it('keeps full-access approval explicit and sends no browser billing provenance', async () => {
    const item = pending('approval', 'make_api_request')
    installPending(item)
    store().setState({ accessLevel: 'full' })
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
    expect(commands.some((request) => request.command === 'tool.approve')).toBe(false)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    const approval = commands.find((request) => request.command === 'tool.approve')
    expect(approval).toMatchObject({ target: item.target, workspaceId })
    expect(approval).not.toHaveProperty('financialBinding')
    expect(
      commands.some(
        (request) => request.command === 'tool.execute' || request.command === 'tool.result'
      )
    ).toBe(false)
  })
  it('uses the displayed pending target without another discovery request', async () => {
    const item = pending()
    installPending(item)
    const copy = await store().getState().readPendingTool(item.target.toolCallId)
    expect(copy).toEqual(item)
    copy.originalArgs.changed = true
    expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
    expect(commands).toEqual([])
  })
  it('restores a persisted preview and accepts through one server-owned continuation', async () => {
    const item = pending('result', 'edit_workflow')
    item.preview = { requiresReview: true }
    installPending(item)
    store().setState((state) => displayNativePending(state, item))
    expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
      state: 'review',
      result: item.preview,
    })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
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
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().skipCopilotToolCall(item.target.toolCallId)
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
        second: {
          id: 'second',
          name: second.target.toolName,
          state: ClientToolCallState.pending,
          pending: second,
        },
      },
    }))
    const gate = defer<Response>()
    onCommand = (request) =>
      request.command === 'history.read'
        ? historyResponse([first, second])
        : request.command === 'tool.execute'
          ? gate.promise
          : undefined
    const active = store().getState().executeCopilotToolCall(first.target.toolCallId)
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(true)
    )
    const queued = store().getState().executeCopilotToolCall('second')
    await store().getState().createNewChat()
    gate.resolve(terminalResponse(ready()))
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
    expect(() => getCopilotStoreForToolCall(item.target.toolCallId)).toThrow('unique')
  })
})

describe('canonical history, edits and context', () => {
  it('loads display-only tool history without execution or local transcript writes', async () => {
    const item = pending()
    onCommand = (request) =>
      request.command === 'history.read'
        ? json({
            status: 'history',
            pending: [],
            threadId,
            items: [
              {
                id: 'assistant-history',
                role: 'assistant',
                createdAt: at,
                parts: [
                  {
                    type: 'tool-invocation',
                    toolInvocation: {
                      state: 'call',
                      toolCallId: item.target.toolCallId,
                      toolName: item.target.toolName,
                      args: item.originalArgs,
                    },
                  },
                ],
              },
            ],
          })
        : undefined
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
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
      request.command === 'history.read'
        ? json({
            status: 'history',
            threadId,
            pending: [],
            items: [{ ...history[0], parts: [...history[0].parts, contextPart] }, history[1]],
          })
        : undefined
    await store().getState().selectChat(chat())
    commands.length = 0
    const text = ' exact edit\n'
    const answer = 'Replacement answer'
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse([
            { type: 'response.started', runId, threadId, messageId: history[0].id },
            { type: 'response.completed', result: ready(answer) },
          ])
        : request.command === 'history.read'
          ? json({
              status: 'history',
              threadId,
              pending: [],
              items: [
                { ...history[0], parts: [{ type: 'text', text }, contextPart] },
                { ...history[1], parts: [{ type: 'text', text: answer }] },
              ],
            })
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
    expect(commands.map((request) => request.command)).toEqual(['message', 'history.read'])
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
  const titleOutcome = {
    status: 'completed',
    runId: 'title-run',
    text: '  Generated title  ',
  }
  it('calls utility for the actual first thread/model/scope, then mutates and reads native title only after success', async () => {
    store().setState({ conversationWorkspaceId: workspaceId, selectedModel: 'openai/gpt-5.6-sol' })
    onTitle = () => json({ title: 'Generated title', outcome: titleOutcome })
    expect(await store().getState().sendMessage('First')).toBe(true)
    await vi.waitFor(() => expect(store().getState().currentChat?.title).toBe('verified title'))
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
      store().setState({
        currentChat: { ...chat(), title: '' },
        conversationWorkspaceId: workspaceId,
      })
      let persisted = false
      onCommand = (request) => {
        if (request.command === 'history.read' && persisted && status === 'suspended')
          return historyResponse([pending('approval')])
        if (request.command === 'history.read' && !persisted)
          return json({
            status: 'history',
            pending: [],
            threadId,
            items: [],
          })
        if (request.command !== 'message') return
        persisted = true
        const terminal = status === 'completed' ? ready() : suspended([pending('approval')])
        return eventResponse([
          { type: 'response.started', threadId, runId },
          {
            type: status === 'completed' ? 'response.completed' : 'response.suspended',
            result: terminal,
          },
        ])
      }
      onTitle = () => json({ title: 'Generated title', outcome: titleOutcome })
      const originalInput = ' \nOriginal prompt🔥\t '
      expect(
        await store()
          .getState()
          .sendMessage(originalInput, {
            contexts: [{ kind: 'docs', label: 'Inert context never becomes prompt' }],
          })
      ).toBe(true)
      await vi.waitFor(() => expect(store().getState().currentChat?.title).toBe('verified title'))
      expect(commands[0].command).toBe('history.read')
      expect(titleRequests).toEqual([
        { workspaceId, threadId, model: store().getState().selectedModel, originalInput },
      ])
      expect(commands.filter((request) => request.command === 'thread.title')).toHaveLength(1)
    }
  )
  it.each(['', ' ', 'Untitled', 'New Chat', null])(
    'does not infer initial state from a display title %s or locally empty messages',
    async (title) => {
      store().setState({
        currentChat: { ...chat(), title },
        conversationWorkspaceId: workspaceId,
        messages: [],
      })
      onTitle = () => json({ title: 'Generated title', outcome: titleOutcome })
      expect(await store().getState().sendMessage('A later native interaction')).toBe(true)
      expect(titleRequests).toEqual([]) // The default complete native history already contains a user.
    }
  )
  it('invalidates the captured title generation even if a manual title is later restored to empty before main completion', async () => {
    const late = defer<Response>()
    onCommand = (request) => (request.command === 'message' ? late.promise : undefined)
    onTitle = () => json({ title: 'Generated title', outcome: titleOutcome })
    const sending = store().getState().sendMessage('First')
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'message')).toBe(true)
    )
    store().setState({ currentChat: { ...chat(null), title: 'Manual title' } })
    store().setState({ currentChat: { ...chat(null), title: '' } })
    late.resolve(terminalResponse(ready()))
    expect(await sending).toBe(true)
    expect(titleRequests).toEqual([])
  })
  it('keeps the completed outcome when history readback fails without replaying inference', async () => {
    onCommand = (request) =>
      request.command === 'message'
        ? terminalResponse({ ...ready() })
        : request.command === 'history.read'
          ? json(
              {
                status: 'refused',
                error: {
                  code: 'FORBIDDEN',
                  message: 'Current history access denied',
                },
              },
              403
            )
          : undefined
    expect(await store().getState().sendMessage('First')).toBe(true)
    expect(store().getState().historyRefreshError).toContain('Current history access denied')
    expect(
      store()
        .getState()
        .messages.find((message) => message.role === 'assistant')?.content
    ).toBe('canonical answer')
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
  })
  it('keeps the generated title outcome when publication fails without replay', async () => {
    onTitle = () =>
      json({
        title: 'Generated title',
        outcome: { ...titleOutcome },
      })
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
  it.each(['null', 'error', 'refused', 'cancel_requested'])(
    'publishes no title on %s and never retries the utility',
    async (mode) => {
      store().setState({ conversationWorkspaceId: workspaceId })
      const outcome =
        mode === 'null'
          ? undefined
          : {
              status: mode === 'error' ? 'failed' : mode,
              error: {
                code: 'NATIVE_FAILURE',
                message: 'title unavailable',
              },
            }
      onTitle = () => json({ title: null, ...(outcome ? { outcome } : {}) })
      await store().getState().sendMessage('First')
      await vi.waitFor(() => expect(titleRequests).toHaveLength(1))
      expect(commands.some((request) => request.command === 'thread.title')).toBe(false)
    }
  )
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
      late.resolve(json({ title: 'Generated title', outcome: titleOutcome }))
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
    late.resolve(terminalResponse(ready('Answer for A')))
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
    message.resolve(terminalResponse(ready()))
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
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat(null))
    commands = []
    expect(await store().getState().readPendingTool(item.target.toolCallId)).toEqual(item)
    expect(commands).toEqual([])
    expect(workflowRequests).toEqual([])
    expect(tools.browser).not.toHaveBeenCalled()
  })
  it('rejects a displayed pending card belonging to a different thread', async () => {
    const item = pending()
    item.target.threadId = 'foreign-thread'
    installPending(item)
    await expect(store().getState().readPendingTool(item.target.toolCallId)).rejects.toThrow(
      'selected thread'
    )
    expect(commands).toEqual([])
  })
})

describe('display-only terminal settlement and optional completed history', () => {
  it.each(['error', 'refused', 'cancel'])(
    'settles tool.display on SSE %s while retaining its completed outcome',
    async (kind) => {
      setChat()
      onCommand = (request) =>
        request.command === 'message'
          ? eventResponse([
              {
                type: 'tool.display',
                toolName: 'read_workflow',
                toolCallId: 'display-only',
              },
              kind === 'cancel'
                ? {
                    type: 'response.cancel_requested',
                    result: {
                      status: 'cancel_requested',
                      runId,
                    },
                  }
                : {
                    type: kind === 'error' ? 'response.error' : 'response.refused',
                    result: {
                      status: kind === 'error' ? 'failed' : 'refused',
                      error: {
                        code: 'FAILED',
                        message: 'Actual terminal refusal',
                      },
                    },
                  },
            ])
          : undefined
      await store().getState().sendMessage('read')
      const state = store().getState()
      expect(hasUiActiveToolCalls(state.toolCallsById)).toBe(false)
      expect(state.toolCallsById['display-only'].state).not.toBe(ClientToolCallState.generating)
      expect(
        state.messages
          .flatMap((message) => message.contentBlocks ?? [])
          .find((block) => block.type === 'tool_call')?.toolCall.state
      ).toBe(state.toolCallsById['display-only'].state)
      expect(tools.browser).not.toHaveBeenCalled()
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
    }
  )
  it.each(['json', 'sse'])(
    'preserves completed %s output/parts/facts on malformed optional history and refreshes read-only later',
    async (transport) => {
      setChat()
      const text = ' exact completed🦆\n '
      const reasoning = ' exact reasoning '
      onCommand = (request) =>
        request.command === 'message'
          ? transport === 'json'
            ? terminalResponse(ready(text))
            : eventResponse([
                { type: 'reasoning.delta', text: reasoning },
                { type: 'text.delta', text },
                { type: 'response.completed', result: ready(text) },
              ])
          : request.command === 'history.read'
            ? json({ not: 'history' })
            : undefined
      expect(await store().getState().sendMessage('once')).toBe(true)
      const before = store().getState()
      expect(before.messages.find((message) => message.role === 'assistant')?.content).toBe(text)
      if (transport === 'sse')
        expect(before.messages.flatMap((message) => message.contentBlocks ?? [])).toContainEqual(
          expect.objectContaining({ type: 'thinking', content: reasoning })
        )
      expect(before.lastNativeOutcome?.status).toBe('completed')
      expect(before.historyRefreshError).toBeTruthy()
      onCommand = () => undefined
      await store().getState().refreshCurrentHistory()
      expect(store().getState().historyRefreshError).toBeNull()
      expect(
        store()
          .getState()
          .messages.map((message) => message.content)
      ).toEqual(history.map((message) => message.parts[0].text))
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    }
  )
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
    expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
    expect(store().getState().toolCallsById[item.target.toolCallId].state).toBe(
      ClientToolCallState.pending
    )
    expect(store().getState().toolCallsById['display-only'].state).toBe(ClientToolCallState.aborted)
    expect(hasUiActiveToolCalls(store().getState().toolCallsById)).toBe(true)
  })
})

describe('explicit reopened Drive business choice', () => {
  const drive = () => ({ ...pending('result', 'gdrive_request_access'), originalArgs: {} })
  const prepare = (item = drive()) => {
    installPending(item)
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
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
    await expect(store().getState().authorizeToolWorkspace(item.target.toolCallId)).rejects.toThrow(
      'Choose an authorized workspace'
    )
    expect(
      await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    ).toBe('chosen-business')
    expect(store().getState().toolCallsById[item.target.toolCallId].provenance).toEqual({
      workspaceId: 'chosen-business',
    })
    expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
    expect(store().getState().currentChat?.workspaceId).toBeNull()
    await expect(
      store().getState().readbackCopilotToolCall(item.target.toolCallId)
    ).rejects.toThrow('workspace and credential')
    expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
  })
  it('combines chosen credential readback and continuation in one authenticated command', async () => {
    const item = prepare()
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    await store()
      .getState()
      .readbackCopilotToolCall(item.target.toolCallId, { credentialId: 'explicit-credential' })
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
      store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    ).rejects.toThrow('Native approval')
    item.stage = 'result'
    await expect(
      store().getState().authorizeToolWorkspace(item.target.toolCallId, 'foreign')
    ).rejects.toThrow('unavailable or ambiguous')
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url) === '/api/workspaces'
        ? json({ workspaces: [{ id: 'chosen-business' }, { id: 'chosen-business' }] })
        : original(url, init)
    )
    await expect(
      store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    ).rejects.toThrow('unavailable or ambiguous')
    expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
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
        .authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
      const outcome = expect(operation).rejects.toThrow('selection changed')
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces'))
      if (change === 'navigation') store().getState().createNewChat()
      else
        store().setState((state) => ({
          toolCallsById: {
            ...state.toolCallsById,
            [item.target.toolCallId]: {
              ...state.toolCallsById[item.target.toolCallId],
              pending: { ...item, stage: 'approval' },
            },
          },
        }))
      held.resolve(json({ workspaces: [{ id: 'chosen-business' }] }))
      await outcome
      expect(
        store().getState().toolCallsById[item.target.toolCallId]?.provenance?.workspaceId
      ).toBeUndefined()
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(false)
    }
  )
})

describe('message acceptance', () => {
  it('acknowledges the submitted message while its response is still streaming', async () => {
    setChat()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const emit = (event: object) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\r\n\r\n`))
    onCommand = (request) =>
      request.command === 'message'
        ? new Response(
            new ReadableStream({
              start(stream) {
                controller = stream
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        : undefined
    const onAccepted = vi.fn()
    const finished = vi.fn()
    const sending = store().getState().sendMessage('submitted', { onAccepted }).then(finished)
    await vi.waitFor(() => expect(controller).toBeDefined())
    expect(onAccepted).not.toHaveBeenCalled()
    emit({ type: 'response.started', threadId, runId })
    emit({ type: 'text.delta', text: 'Working' })
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledOnce())
    expect(store().getState().isSendingMessage).toBe(true)
    expect(finished).not.toHaveBeenCalled()

    emit({ type: 'response.completed', result: ready() })
    controller.close()
    await sending
    expect(finished).toHaveBeenCalledWith(true)
    expect(onAccepted).toHaveBeenCalledOnce()
  })

  it.each(['navigation', 'abort', 'failure'])(
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
      if (kind === 'abort') await store().getState().abortMessage()
      held.resolve(
        kind === 'failure'
          ? json({ error: 'failed' }, 500)
          : eventResponse([
              { type: 'response.started', threadId, runId },
              { type: 'response.completed', result: ready() },
            ])
      )
      expect(await sending).toBe(false)
      expect(onAccepted).not.toHaveBeenCalled()
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
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
      request.command === 'history.read' ? historyResponse([target]) : undefined
    await store().getState().selectChat(chat())
    commands = []
    onCommand = () => undefined
    return target
  }

  it('keeps Run available after a local busy refusal and admits one later explicit attempt', async () => {
    const target = await install()
    useExecutionStore.getState().setIsExecuting(true)
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
    expect(tools.runWorkflow).not.toHaveBeenCalled()
    expect(commands).toEqual([])
    expect(store().getState().toolCallsById[target.target.toolCallId]).toMatchObject({
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
    const retry = store().getState().executeCopilotToolCall(target.target.toolCallId)
    await vi.waitFor(() => expect(tools.runWorkflow).toHaveBeenCalledOnce())
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
    expect(tools.runWorkflow).toHaveBeenCalledOnce()
    admitted.resolve({ success: true, output: {}, logs: [] })
    await retry
    expect(tools.runWorkflow).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        executionId: target.target.toolCallId,
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
    let otherSettled = false
    onCommand = (request) => {
      if (request.command === 'message') return terminalResponse(suspended([target, other]))
      if (request.command === 'history.read')
        return historyResponse(otherSettled ? [target] : [target, other])
      if (request.command === 'tool.execute' && request.target.toolCallId === 'other') {
        otherSettled = true
        return terminalResponse(suspended([target]))
      }
    }
    await store().getState().sendMessage('Run the workflow')
    await vi.waitFor(() => expect(store().getState().error).toContain('Try again later'))
    expect(tools.runWorkflow).not.toHaveBeenCalled()
    useExecutionStore.getState().setIsExecuting(false)
    await store().getState().executeCopilotToolCall('other')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(tools.runWorkflow).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
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
      await store().getState().executeCopilotToolCall(target.target.toolCallId)
      expect(tools.runWorkflow).toHaveBeenCalledOnce()
      expect(store().getState().toolCallsById[target.target.toolCallId]).toMatchObject({
        state: ClientToolCallState.error,
        pending: target,
      })
      await store().getState().executeCopilotToolCall(target.target.toolCallId)
      expect(tools.runWorkflow).toHaveBeenCalledOnce()
      expect(store().getState().error).toContain('already attempted')
    }
  )

  it('does not infer a safe retry from restored Pending after an uncertain execution', async () => {
    const target = await install()
    tools.runWorkflow.mockRejectedValue(new Error('Execution response unavailable'))
    onCommand = (request) => {
      if (request.command === 'history.read') return historyResponse([target])
      if (request.command === 'cancel')
        return json(
          { status: 'failed', error: { code: 'FAILED', message: 'Cancellation refused' } },
          503
        )
    }
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
    expect(tools.runWorkflow).toHaveBeenCalledOnce()
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[target.target.toolCallId]).toMatchObject({
      state: ClientToolCallState.pending,
      pending: target,
      historyOrigin: true,
    })
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
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
      request.command === 'history.read' ? historyResponse([target]) : undefined
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
        ? terminalResponse(suspended([target]))
        : request.command === 'history.read'
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
    const connecting = store().getState().executeCopilotToolCall(target.target.toolCallId)
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
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
    expect(open).toHaveBeenCalledOnce()
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
    expect(open).toHaveBeenCalledTimes(2)
    expect(opened.location.replace).toHaveBeenCalledOnce()
    expect(store().getState().toolCallsById[target.target.toolCallId].result).toMatchObject({
      opened: true,
    })
    await store().getState().executeCopilotToolCall(target.target.toolCallId)
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
      const connecting = store().getState().executeCopilotToolCall(target.target.toolCallId)
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
      if (request.command === 'history.read') return historyResponse([item])
      if (request.command === 'tool.approve') {
        item.stage = 'result'
        return terminalResponse(suspended([item]))
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
    expect(store().getState().toolCallsById[item.target.toolCallId].provenance).toBeUndefined()
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().error).toContain('Choose an authorized workspace')
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    tools.browser.mockImplementationOnce(async () => {
      store().setState((state) => ({
        toolCallsById: {
          ...state.toolCallsById,
          [item.target.toolCallId]: {
            ...state.toolCallsById[item.target.toolCallId],
            result: { opened: true, surface: 'integrations' },
          },
        },
      }))
    })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith(item.originalArgs)
    expect(tools.bind).toHaveBeenLastCalledWith(
      item.target.toolCallId,
      expect.objectContaining({ workspaceId: 'chosen-business' })
    )
    const call = store().getState().toolCallsById[item.target.toolCallId]
    expect(call.pending).toEqual(item)
    expect(call.params).toEqual({ providerName: 'Google Drive' })
    expect(store().getState().currentChat?.workspaceId).toBeNull()
    expect(store().getState().conversationWorkspaceId).toBeNull()
    const block = store()
      .getState()
      .messages.flatMap((message) => message.contentBlocks ?? [])
      .find((part) => part.type === 'tool_call' && part.toolCall.id === item.target.toolCallId)
    expect(block?.type === 'tool_call' && block.toolCall.provenance).toEqual(call.provenance)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).toHaveBeenCalledTimes(1)
    expect(commands.some((request) => request.command === 'message')).toBe(false)
  })
  it('requires native approval before choosing, then authorizes the distinct business workspace', async () => {
    const item = oauth()
    item.stage = 'approval'
    await reopen(item)
    await expect(
      store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    ).rejects.toThrow('Native approval')
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(commands.filter((request) => request.command === 'tool.approve')).toHaveLength(1)
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith({ providerName: 'Google Drive' })
    expect(store().getState().currentChat?.workspaceId).toBeNull()
  })
  it('requires an explicit business workspace when a reopened OAuth card has no workspace', async () => {
    const item = await reopen()
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [item.target.toolCallId]: {
          ...state.toolCallsById[item.target.toolCallId],
          provenance: { contextEntityKind: 'workflow', contextEntityId: 'original-workflow' },
        },
      },
    }))
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
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
      store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    ).rejects.toThrow('ambiguous')
    allowed = [{ id: 'chosen-business', name: 'Business' }]
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    allowed = []
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).not.toHaveBeenCalled()
    allowed = [{ id: 'chosen-business', name: 'Business' }]
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
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
        .authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
      const outcome = expect(choice).rejects.toThrow('selection changed')
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspaces'))
      if (change === 'navigation') store().getState().createNewChat()
      else
        store().setState((state) => ({
          toolCallsById: {
            ...state.toolCallsById,
            [item.target.toolCallId]: {
              ...state.toolCallsById[item.target.toolCallId],
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
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    tools.browser.mockImplementation(async () => {
      store().setState((state) => ({
        toolCallsById: {
          ...state.toolCallsById,
          [item.target.toolCallId]: {
            ...state.toolCallsById[item.target.toolCallId],
            result: { opened: true, surface: 'integrations' },
          },
        },
      }))
      throw new Error('native acknowledgement failed')
    })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).toHaveBeenCalledTimes(1)
    expect(store().getState().toolCallsById[item.target.toolCallId].result).toMatchObject({
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
        if (request.command === 'history.read') return historyResponse(items)
        if (request.command === 'message') {
          if (order === 'terminal') return terminalResponse(suspended(items))
          const displays = items.map((item) => ({
            type: 'tool.display',
            toolCallId: item.target.toolCallId,
            toolName: item.target.toolName,
          }))
          return eventResponse([
            { type: 'response.started', threadId, runId },
            ...displays,
            { type: 'response.suspended', result: suspended(items) },
          ])
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
        const call = store().getState().toolCallsById[item.target.toolCallId]
        expect(call.provenance).toEqual(expected[index])
        const block = store()
          .getState()
          .messages.flatMap((message) => message.contentBlocks ?? [])
          .find((part) => part.type === 'tool_call' && part.toolCall.id === item.target.toolCallId)
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
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
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
        if (request.command === 'history.read')
          return json({
            status: 'history',
            threadId: b.threadId,
            items: [],
            pending: continued ? [next] : [first],
          })
        if (request.command === 'tool.approve') {
          continued = true
          return eventResponse([
            {
              type: 'tool.display',
              toolCallId: next.target.toolCallId,
              toolName: next.target.toolName,
            },
            {
              type: 'response.suspended',
              result: {
                status: 'suspended',
                threadId: b.threadId,
                runId: first.target.runId,
                text: '',
                pending: [next],
              },
            },
          ])
        }
        if (request.command === 'tool.execute')
          return terminalResponse({
            status: 'completed',
            threadId: b.threadId,
            runId: first.target.runId,
            text: 'Done',
          })
      }
      await store().getState().selectChat(b)
      expect(store().getState().toolCallsById[first.target.toolCallId].provenance).toEqual(context)
      await store().getState().executeCopilotToolCall(first.target.toolCallId)
      expect(store().getState().toolCallsById[next.target.toolCallId].provenance).toEqual(context)
      await store().getState().executeCopilotToolCall(next.target.toolCallId)
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
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    expect(tools.browser).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith(item.originalArgs)
    expect(tools.bind).toHaveBeenLastCalledWith(
      item.target.toolCallId,
      expect.objectContaining(item.context)
    )
  })

  it('keeps an explicit OAuth workspace choice through native history refresh', async () => {
    const item: Pending = {
      ...pending('result', 'oauth_request_access'),
      originalArgs: { providerName: 'Google Drive' },
      context: { contextEntityKind: 'workflow', contextEntityId: 'workflow-B' },
    }
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url) === '/api/workspaces'
        ? Promise.resolve(json({ workspaces: [{ id: 'chosen-business' }] }))
        : original(url, init)
    )
    await store().getState().selectChat(chat(null))
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    await store().getState().refreshCurrentHistory()
    expect(store().getState().toolCallsById[item.target.toolCallId].provenance).toEqual({
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
      request.command === 'history.read' ? historyResponse([item]) : undefined
    return item
  }
  const open = () =>
    store().getState().openWorkflowChatDeployment('call-fixture', {
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
      toolCallId: item.target.toolCallId,
      workflowId: 'target-a',
      workspaceId: 'original-entity-workspace',
      opened: false,
    })
    expect(request.isCurrent()).toBe(true)
    expect(completed).toBe(false)
    expect(store().getState().toolCallsById[item.target.toolCallId].result).toBeUndefined()
    store().getState().settleWorkflowChatDeployment(request.id, 'opened')
    expect(store().getState().toolCallsById[item.target.toolCallId].result).toEqual({
      opened: true,
      surface: 'chat-deployment',
      message: 'Opened chat deployment settings',
    })
    expect(store().getState().toolCallsById[item.target.toolCallId].state).toBe(
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
      .submitBrowserAssertion(item.target.toolCallId, {
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
      expect(store().getState().toolCallsById['call-fixture'].result).toBeUndefined()
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
        [item.target.toolCallId]: {
          ...state.toolCallsById[item.target.toolCallId],
          pending: { ...item, stage: 'approval' },
        },
      },
    }))
    expect(request.isCurrent()).toBe(false)
    store().getState().settleWorkflowChatDeployment(request.id, 'opened')
    await refused
    expect(store().getState().toolCallsById[item.target.toolCallId].result).toBeUndefined()
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
        store().getState().openWorkflowChatDeployment(item.target.toolCallId, scope)
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
    expect(store().getState().toolCallsById['call-fixture'].result).toBeUndefined()
  })
})

describe('built-in tool continuation', () => {
  it.each<{ toolName: string; originalArgs: Pending['originalArgs'] }>([
    { toolName: 'plan', originalArgs: { objective: 'Research', todoList: ['Inspect workflow'] } },
    { toolName: 'sleep', originalArgs: { seconds: 0 } },
    { toolName: 'checkoff_todo', originalArgs: { id: 'todo-1' } },
    { toolName: 'mark_todo_in_progress', originalArgs: { id: 'todo-1' } },
  ])(
    'automatically executes a live $toolName invocation after persisted history refresh',
    async ({ toolName, originalArgs }) => {
      const item = { ...pending('result', toolName), originalArgs }
      onCommand = (request) =>
        request.command === 'message'
          ? terminalResponse(suspended([item]))
          : request.command === 'history.read'
            ? historyResponse([item])
            : undefined
      expect(await store().getState().sendMessage('Continue')).toBe(true)
      await vi.waitFor(() => expect(tools.browser).toHaveBeenCalledExactlyOnceWith(originalArgs))
      const call = store().getState().toolCallsById[item.target.toolCallId]
      expect(call.historical).toBe(false)
      expect(call.historyOrigin).toBeUndefined()
      const part = store()
        .getState()
        .messages.flatMap((message) => message.contentBlocks ?? [])
        .find((block) => block.type === 'tool_call' && block.toolCall.id === item.target.toolCallId)
      expect(part?.type === 'tool_call' && part.toolCall).toBe(call)
      await store().getState().refreshCurrentHistory()
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
      expect(tools.browser).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps a reopened browser invocation ineligible through repeated history refreshes', async () => {
    const item = { ...pending('result', 'plan'), originalArgs: { objective: 'Historical plan' } }
    onCommand = (request) =>
      request.command === 'history.read' ? historyResponse([item]) : undefined
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[item.target.toolCallId].historyOrigin).toBe(true)
    await store().getState().refreshCurrentHistory()
    expect(await store().getState().sendMessage('Continue')).toBe(false)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[item.target.toolCallId].historyOrigin).toBe(true)
  })

  it.each([
    { state: ClientToolCallState.executing, result: undefined },
    { state: ClientToolCallState.error, result: { objective: 'Known browser result' } },
  ])('preserves live $state state when history has no matching invocation', async (live) => {
    const item = {
      ...pending('result', 'plan'),
      originalArgs: { objective: 'Live plan' },
      context: { workspaceId: 'pinned-workspace' },
    }
    installPending(item)
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [item.target.toolCallId]: {
          ...state.toolCallsById[item.target.toolCallId],
          ...live,
          provenance: { workspaceId: 'pinned-workspace' },
        },
      },
    }))
    onCommand = (request) =>
      request.command === 'history.read'
        ? json({ status: 'history', threadId, items: history, pending: [item] })
        : undefined
    await store().getState().refreshCurrentHistory()
    const call = store().getState().toolCallsById[item.target.toolCallId]
    expect(call).toMatchObject({ ...live, provenance: { workspaceId: 'pinned-workspace' } })
    expect(call.pending).toEqual(item)
    expect(call.historyOrigin).toBeUndefined()
    expect(tools.browser).not.toHaveBeenCalled()
  })

  it('never autoexecutes a cold pending tool omitted from history after another tool continues', async () => {
    const cold = { ...pending('result', 'plan'), originalArgs: { objective: 'Reopened plan' } }
    const other = {
      ...cold,
      target: { ...cold.target, toolCallId: 'other-call' },
      originalArgs: { objective: 'Explicit plan' },
    }
    let items = [other, cold]
    onCommand = (request) => {
      if (request.command === 'history.read')
        return json({ status: 'history', threadId, items: history, pending: items })
      if (request.command === 'tool.result') {
        items = [cold]
        return terminalResponse(suspended(items))
      }
      return undefined
    }
    await store().getState().selectChat(chat())
    await store().getState().submitBrowserAssertion(other.target.toolCallId, {
      kind: 'plan.updated',
      data: other.originalArgs,
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(tools.browser).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[cold.target.toolCallId].historyOrigin).toBe(true)
  })

  it.each(['runId', 'resourceId', 'toolName', 'originalArgs', 'context'] as const)(
    'does not transfer live origin when authoritative pending %s changes',
    async (field) => {
      const item = { ...pending('result', 'plan'), originalArgs: { objective: 'Live plan' } }
      const changed: Pending = structuredClone(item)
      if (field === 'originalArgs') changed.originalArgs = { objective: 'Changed plan' }
      else if (field === 'context') changed.context = { workspaceId: 'changed-workspace' }
      else if (field === 'toolName') {
        changed.target.toolName = 'checkoff_todo'
        changed.originalArgs = { id: 'todo-1' }
      } else changed.target[field] = 'changed'
      onCommand = (request) =>
        request.command === 'message'
          ? terminalResponse(suspended([item]))
          : request.command === 'history.read'
            ? historyResponse([changed])
            : undefined
      expect(await store().getState().sendMessage('Continue')).toBe(true)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(tools.browser).not.toHaveBeenCalled()
      const call = store().getState().toolCallsById[item.target.toolCallId]
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
          ? terminalResponse(suspended([item]))
          : request.command === 'history.read'
            ? historyResponse([item])
            : undefined
      expect(await store().getState().sendMessage('Prepare edit')).toBe(true)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
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
      request.command === 'history.read'
        ? historyResponse([item, other])
        : request.command === 'tool.execute'
          ? terminalResponse(suspended([other]))
          : undefined
    await store().getState().readPendingTool(item.target.toolCallId)
    await store().getState().skipCopilotToolCall(item.target.toolCallId)
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
        ? terminalResponse(suspended([fresh]))
        : request.command === 'history.read'
          ? historyResponse([fresh])
          : undefined
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(commands.filter((request) => request.command === 'tool.execute')).toEqual([
      expect.objectContaining({ action: 'execute', target: item.target }),
    ])
    expect(store().getState().toolCallsById[item.target.toolCallId].state).toBe('review')
  })
  it('a concurrent rejection cannot claim success while acceptance is in flight', async () => {
    const item = pending('result', 'edit_workflow')
    item.preview = { requiresReview: true }
    installPending(item)
    const gate = defer<Response>()
    onCommand = (request) =>
      request.command === 'history.read'
        ? historyResponse([item])
        : request.command === 'tool.execute'
          ? gate.promise
          : undefined
    await store().getState().readPendingTool(item.target.toolCallId)
    const active = store().getState().executeCopilotToolCall(item.target.toolCallId)
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'tool.execute')).toBe(true)
    )
    await expect(store().getState().skipCopilotToolCall(item.target.toolCallId)).rejects.toThrow(
      'already in flight'
    )
    gate.resolve(terminalResponse(ready()))
    await active
    expect(commands.filter((request) => request.command === 'tool.execute')).toHaveLength(1)
  })
  it('renders authoritative automatic tool results without a browser round trip', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse([
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
            { type: 'response.completed', result: ready() },
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
  it('refreshes successful mutations in their actual workspace from a personal conversation', async () => {
    store().setState({ currentChat: chat(null), conversationWorkspaceId: null })
    const result = ToolResultSchemas.edit_monitor.parse({
      success: true,
      surfaceKind: 'monitor',
      monitorId: 'monitor',
      documentFormat: MONITOR_DOCUMENT_FORMAT,
      monitorDocument: '{}',
      workspaceId: 'actual-business-workspace',
    })
    expect(result).toHaveProperty('workspaceId', 'actual-business-workspace')
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse([
            {
              type: 'tool.result',
              toolCallId: 'mutation',
              toolName: 'edit_monitor',
              result,
            },
            { type: 'response.completed', result: ready() },
          ])
        : undefined
    expect(await store().getState().sendMessage('Update monitor')).toBe(true)
    expect(tools.refresh).toHaveBeenCalledExactlyOnceWith('edit_monitor', result)
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
      const projected = applyNativeEvent(store().getState(), failed, 'assistant')
      expect(projected.toolCallsById?.failed).toMatchObject({
        state: outcome === 'error' ? ClientToolCallState.error : ClientToolCallState.rejected,
        result: { error: 'Tool failed' },
      })
      onCommand = (request) =>
        request.command === 'message'
          ? eventResponse([
              {
                type: 'tool.display',
                toolCallId: 'failed',
                toolName: 'search_online',
                args: { query: 'search' },
              },
              { ...failed },
              { type: 'response.completed', result: ready() },
            ])
          : undefined
      expect(await store().getState().sendMessage('Search')).toBe(true)
      expect(tools.refresh).not.toHaveBeenCalled()
    }
  )
})
