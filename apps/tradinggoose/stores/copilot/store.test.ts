import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COPILOT_NATIVE_REVISION,
  type FinancialFact,
  type Pending,
  parseNativeContract,
} from '@/lib/copilot/native/contract'
import type { StudioNativeCommand } from '@/lib/copilot/native/studio-request'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import { buildCopilotWorkspaceChannelId } from './channel-id'
import { getCopilotStore, resetCopilotStoreRegistry } from './store'
import { getCopilotStoreForToolCall } from './store-access'
import { hasUiActiveToolCalls } from './store-state'
import { applyNativeEvent } from './streaming'
import type { CopilotChat } from './types'

const tools = vi.hoisted(() => ({
  execute: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  refresh: vi.fn(),
  browser: vi.fn(),
  bind: vi.fn(),
  hydrate: vi.fn(),
}))
vi.mock('@/lib/copilot/tools/client/server-tool-response', async (original) => ({
  ...(await original<object>()),
  executeCopilotServerTool: tools.execute,
  acceptCopilotServerToolReview: tools.accept,
  rejectCopilotServerToolReview: tools.reject,
}))
vi.mock('./tool-registry', async (original) => ({
  ...(await original<object>()),
  handleCopilotServerToolSuccess: tools.refresh,
  ensureClientToolInstance: () => ({
    handleUserAction: tools.browser,
    hydrateToolCall: tools.hydrate,
  }),
  bindClientToolExecutionContext: tools.bind,
}))
const financial: FinancialFact = { accepted: true, appliedUsd: '0', modelUsd: 'unavailable' }
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
  financialBinding: {
    namespace: 'billing-usage:fixture-owner',
    key: 'fixture-operation',
    fingerprint: 'fixture-fingerprint',
    runId,
    actorUserId,
    workspaceId,
    workflowId: null,
    purpose: 'copilot',
  },
  financialOccurrence: { stepNumber: 7, retryCount: 3, runId },
})
const defer = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const result = (request: StudioNativeCommand, value: object) => ({
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId: request.requestId,
  ...value,
})
const json = (value: unknown, status = 200) => Response.json(value, { status })
const ready = (request: StudioNativeCommand, text = 'canonical answer') =>
  result(request, { status: 'completed', threadId, runId, text, financial })
const suspended = (request: StudioNativeCommand, items: Pending[]) =>
  result(request, { status: 'suspended', threadId, runId, text: '', pending: items, financial })
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
let commands: StudioNativeCommand[]
let onCommand: (
  request: StudioNativeCommand,
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
        state: ClientToolCallState.pending,
        params: item.originalArgs,
        pending: item,
      },
    },
  })
}
function defaultResponse(request: StudioNativeCommand) {
  if (request.command === 'history.read')
    return json(
      result(request, {
        status: 'history',
        threadId: request.threadId,
        items: history,
        page: request.page,
        hasMore: false,
      })
    )
  if (request.command === 'pending.list')
    return json(
      result(request, { status: 'pending_targets', items: [], page: request.page, hasMore: false })
    )
  if (request.command === 'threads.list')
    return json(
      result(request, {
        status: 'threads',
        items: [{ id: threadId, title: 'verified title', createdAt: at, updatedAt: at }],
        page: request.page,
        hasMore: false,
      })
    )
  if (request.command === 'context.read')
    return json(
      result(request, {
        status: 'context',
        threadId: request.threadId,
        contextTokens: null,
        tokenSource: 'unavailable',
      })
    )
  if (
    request.command === 'thread.title' ||
    request.command === 'history.edit' ||
    request.command === 'thread.delete'
  )
    return json(
      result(request, {
        status: 'updated',
        operation: request.command,
        threadId: request.threadId,
        ...(request.command === 'history.edit' ? { messageId: request.messageId } : {}),
      })
    )
  if (request.command === 'cancel')
    return json(
      result(request, {
        status: 'cancel_requested',
        runId: request.runId,
        acknowledged: true,
        uncertaintyRemains: true,
      })
    )
  return json(ready(request))
}
function eventResponse(request: StudioNativeCommand, events: object[]) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(
    events.map((value) => `data: ${JSON.stringify(result(request, value))}\r\n\r\n`).join('')
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
      const request = JSON.parse(String(init?.body)) as StudioNativeCommand
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
            result(request, {
              status: 'refused',
              error: {
                code: 'FORBIDDEN',
                message: 'Source access denied',
                retryable: false,
                uncertain: false,
              },
            }),
            403
          )
        : undefined
    expect(
      await store()
        .getState()
        .sendMessage('image prompt', {
          fileAttachments: [
            {
              id: 'image',
              key: 'private',
              sourceProof: 'local-proof',
              filename: 'duck.png',
              media_type: 'image/png',
              size: 10,
            },
          ],
        })
    ).toBe(false)
    expect(commands).toEqual([
      expect.objectContaining({
        command: 'message',
        input: { content: 'image prompt', contexts: [] },
        fileAttachments: [
          {
            key: 'private',
            sourceProof: 'local-proof',
            filename: 'duck.png',
            media_type: 'image/png',
            size: 10,
          },
        ],
      }),
    ])
    expect(titleRequests).toEqual([])
    expect(store().getState().draft.text).toBe('image prompt')
    expect(store().getState().error).toBe('Source access denied')
  })
  it('sends image-only selection in original order as Studio source descriptors without a caption or title utility', async () => {
    const files = ['first', 'second'].map((id) => ({
      id,
      key: `owned/${id}`,
      sourceProof: `proof-${id}`,
      filename: `${id}.png`,
      media_type: 'image/png',
      size: 70,
    }))
    expect(await store().getState().sendMessage(' \n\t ', { fileAttachments: files })).toBe(true)
    expect(commands.find((command) => command.command === 'message')).toMatchObject({
      input: { content: ' \n\t ', contexts: [] },
      fileAttachments: files.map(({ id: _id, ...descriptor }) => descriptor),
    })
    expect(titleRequests).toEqual([])
  })
  it.each([undefined, null, 0, 0.02, '0.00', '1e-2', '-1'])(
    'refuses invalid accepted monetary fact %s without title publication, fake zero or replay',
    async (appliedUsd) => {
      onCommand = (request) =>
        request.command === 'message'
          ? json({ ...ready(request), financial: { ...financial, appliedUsd } })
          : undefined
      expect(await store().getState().sendMessage('First')).toBe(false)
      expect(store().getState().lastNativeFinancial).toBeNull()
      expect(store().getState().error).toBeTruthy()
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
      expect(titleRequests).toEqual([])
    }
  )
  it('refuses a wrong-command pruning terminal without inventing a model acceptance fact', async () => {
    setChat()
    onCommand = (request) => {
      if (request.command !== 'message') return
      const wrong = result(request, {
        status: 'compacted',
        threadId,
        applied: true,
        sourceBoundaryVerified: true,
      })
      return json(wrong)
    }
    expect(await store().getState().sendMessage('First')).toBe(false)
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'failed',
      error: { code: 'UNCERTAIN', uncertain: true },
    })
    expect(store().getState().lastNativeFinancial).toBeNull()
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
    expect(commands.some((request) => request.command === 'context.compact')).toBe(false)
    expect(titleRequests).toEqual([])
  })
  it('preserves split UTF8, reasoning/text order and native final canonical content', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse(request, [
            { type: 'response.started', runId, threadId },
            { type: 'reasoning.delta', text: 'thinking🦆' },
            { type: 'text.delta', text: 'preview' },
            { type: 'response.completed', result: ready(request) },
          ])
        : undefined
    expect(await store().getState().sendMessage('Hello')).toBe(true)
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'completed',
      text: 'canonical answer',
      financial,
    })
    expect(store().getState().messages.at(-1)?.content).toBe('canonical answer')
  })
  it.each(['missing-terminal', 'raw-openai', 'trailing-data', 'wrong-correlation'])(
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
                    ...ready(request),
                    ...(mode === 'wrong-correlation' ? { requestId: 'stale' } : {}),
                  },
                },
                ...(mode === 'trailing-data' ? [{ type: 'text.delta', text: 'extra' }] : []),
              ]
        return eventResponse(request, events)
      }
      expect(await store().getState().sendMessage('Hello')).toBe(false)
      expect(store().getState().error).toBeTruthy()
      expect(titleRequests).toEqual([])
    }
  )
  it('preserves a known accepted financial error rather than reporting EOF success', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse(request, [
            {
              type: 'response.error',
              result: result(request, {
                status: 'failed',
                error: {
                  code: 'NATIVE_FAILURE',
                  message: 'Output failed after acceptance',
                  retryable: false,
                  uncertain: false,
                },
                financial: { ...financial, appliedUsd: '0.02' },
              }),
            },
          ])
        : undefined
    expect(await store().getState().sendMessage('Hello')).toBe(false)
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'failed',
      financial: { appliedUsd: '0.02' },
    })
    expect(titleRequests).toEqual([])
  })
  it('retains accepted financial facts from a genuine pending event when cancellation follows', async () => {
    setChat()
    const item = pending('approval')
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse(request, [
            { type: 'response.started', runId, threadId },
            {
              type: 'tool.pending',
              pending: item,
              financial: { ...financial, appliedUsd: '0.02' },
            },
            {
              type: 'response.cancel_requested',
              result: result(request, {
                status: 'cancel_requested',
                runId,
                acknowledged: true,
                uncertaintyRemains: true,
              }),
            },
          ])
        : undefined
    expect(await store().getState().sendMessage('Read')).toBe(false)
    expect(store().getState().lastNativeFinancial).toMatchObject({
      accepted: true,
      appliedUsd: '0.02',
    })
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'failed',
      error: { code: 'UNCERTAIN', uncertain: true },
    })
  })
  it('retains accepted financial facts during actual UI abort and a separate cancel acknowledgement', async () => {
    setChat()
    const item = pending('approval')
    let streamCancelled = false
    onCommand = (request) =>
      request.command === 'message'
        ? new Response(
            new ReadableStream({
              start(controller) {
                const frames = [
                  { type: 'response.started', runId, threadId },
                  {
                    type: 'tool.pending',
                    pending: item,
                    financial: { ...financial, appliedUsd: '0.02' },
                  },
                ]
                controller.enqueue(
                  new TextEncoder().encode(
                    frames
                      .map((frame) => `data: ${JSON.stringify(result(request, frame))}\n\n`)
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
        : undefined
    const sending = store().getState().sendMessage('Read')
    await vi.waitFor(() => expect(store().getState().lastNativeFinancial?.appliedUsd).toBe('0.02'))
    store().getState().abortMessage()
    expect(await sending).toBe(false)
    await vi.waitFor(() =>
      expect(store().getState().lastNativeOutcome?.status).toBe('cancel_requested')
    )
    expect(streamCancelled).toBe(true)
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([
      expect.objectContaining({ threadId, runId, workspaceId }),
    ])
    expect(store().getState().lastNativeFinancial).toMatchObject({
      accepted: true,
      appliedUsd: '0.02',
    })
    expect(store().getState().lastNativeOutcome).toMatchObject({
      status: 'cancel_requested',
      uncertaintyRemains: true,
    })
  })
  it('rejects a stale thread response without selecting it', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message' ? json({ ...ready(request), threadId: 'other' }) : undefined
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

describe('genuine pending, native approval and business review', () => {
  it('renders display events without dispatch or authority', async () => {
    setChat()
    onCommand = (request) =>
      request.command === 'message'
        ? eventResponse(request, [
            {
              type: 'tool.display',
              toolName: 'read_workflow',
              toolCallId: 'display',
              executionAuthorized: false,
            },
            { type: 'response.completed', result: ready(request) },
          ])
        : undefined
    await store().getState().sendMessage('Read')
    expect(tools.execute).not.toHaveBeenCalled()
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
  })
  it('never autoapproves under full access and refuses a nontransitioning approval reply', async () => {
    store().setState({ accessLevel: 'full', conversationWorkspaceId: workspaceId })
    const item = pending('approval')
    onCommand = (request) =>
      request.command === 'message'
        ? json(suspended(request, [item]))
        : request.command === 'pending.list'
          ? json(
              result(request, {
                status: 'pending_targets',
                items: [item],
                page: request.page,
                hasMore: false,
              })
            )
          : undefined
    await store().getState().sendMessage('Read')
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(commands.some((request) => request.command === 'tool.approve')).toBe(false)
    expect(tools.execute).not.toHaveBeenCalled()
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(commands.find((request) => request.command === 'tool.approve')).toMatchObject({
      target: item.target,
      financialBinding: item.financialBinding,
    })
    expect(tools.execute).not.toHaveBeenCalled()
  })
  it.each(['target', 'originalArgs', 'financialBinding', 'financialOccurrence'])(
    'refuses a changed original %s before business execution',
    async (field) => {
      const item = pending()
      installPending(item)
      const changed = structuredClone(item)
      if (field === 'target') changed.target.resourceId = 'forged'
      if (field === 'originalArgs') changed.originalArgs.workflowId = 'other'
      if (field === 'financialBinding') changed.financialBinding.fingerprint = 'other'
      if (field === 'financialOccurrence') changed.financialOccurrence.retryCount++
      onCommand = (request) =>
        request.command === 'pending.list'
          ? json(
              result(request, {
                status: 'pending_targets',
                items: [changed],
                page: request.page,
                hasMore: false,
              })
            )
          : undefined
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
      expect(tools.execute).not.toHaveBeenCalled()
      expect(store().getState().error).toContain('changed')
    }
  )
  it('keeps preview, business review accept and final signed resume distinct', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    onCommand = (request) =>
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [item],
              page: request.page,
              hasMore: false,
            })
          )
        : undefined
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'review-token' },
    })
    tools.accept.mockResolvedValue({
      success: true,
      result: { success: true, workflowId: 'entity-fixture' },
      proof: 'signed-proof',
    })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(store().getState().toolCallsById[item.target.toolCallId].state).toBe('review')
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(tools.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        native: { workspaceId, target: item.target },
        reviewToken: 'review-token',
      })
    )
    expect(commands.find((request) => request.command === 'tool.result')).toMatchObject({
      source: 'studio_signed',
      target: item.target,
      financialBinding: item.financialBinding,
      proof: 'signed-proof',
    })
  })
  it('never repeats an effect after uncertain delivery; explicit readback only publishes proof', async () => {
    const item = pending()
    installPending(item)
    let deliver = false
    onCommand = (request) =>
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [item],
              page: request.page,
              hasMore: false,
            })
          )
        : request.command === 'tool.result' && !deliver
          ? Promise.reject(new Error('connection lost'))
          : undefined
    tools.execute
      .mockResolvedValueOnce({ success: true, result: { success: true }, proof: 'proof' })
      .mockResolvedValue({ success: true, result: { success: true }, proof: 'readback-proof' })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(store().getState().error).toContain('requires delivery or authorized readback')
    deliver = true
    await store().getState().readbackCopilotToolCall(item.target.toolCallId)
    expect(tools.execute).toHaveBeenLastCalledWith({
      native: { workspaceId, target: item.target },
      action: 'readback',
    })
    expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(2)
  })
  it('declines approval separately and refuses unsupported result-stage Skip without canceling unrelated work', async () => {
    const item = pending('approval')
    installPending(item)
    onCommand = (request) =>
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [item],
              page: request.page,
              hasMore: false,
            })
          )
        : undefined
    await store().getState().skipCopilotToolCall(item.target.toolCallId)
    expect(commands.some((request) => request.command === 'tool.decline')).toBe(true)
    item.stage = 'result'
    installPending(item)
    commands = []
    await expect(store().getState().skipCopilotToolCall(item.target.toolCallId)).rejects.toThrow(
      'no server preview'
    )
    expect(
      commands.some((request) =>
        ['cancel', 'tool.decline', 'tool.result'].includes(request.command)
      )
    ).toBe(false)
  })
  it('serializes business actions and cancels queued work after the conversation changes', async () => {
    const first = pending()
    const second = structuredClone(first)
    second.target.toolCallId = 'second'
    installPending(first)
    store().setState({
      toolCallsById: {
        ...store().getState().toolCallsById,
        second: {
          id: 'second',
          name: second.target.toolName,
          state: ClientToolCallState.pending,
          params: second.originalArgs,
          pending: second,
        },
      },
    })
    onCommand = (request) =>
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [first, second],
              page: request.page,
              hasMore: false,
            })
          )
        : undefined
    const late = defer<{ success: boolean; result: object; proof: string }>()
    tools.execute.mockReturnValue(late.promise)
    const a = store().getState().executeCopilotToolCall(first.target.toolCallId)
    const b = store().getState().executeCopilotToolCall(second.target.toolCallId)
    await vi.waitFor(() => expect(tools.execute).toHaveBeenCalledOnce())
    const signal = tools.execute.mock.calls[0][0].signal as AbortSignal
    await store().getState().createNewChat('other-workspace')
    expect(signal.aborted).toBe(true)
    late.resolve({ success: true, result: { success: true }, proof: 'late-proof' })
    await Promise.all([a, b])
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
    expect(store().getState().currentChat).toBeNull()
    expect(store().getState().error).toBeNull()
  })
  it('refuses ambiguous local tool IDs across stores instead of choosing an owner', () => {
    const item = pending()
    installPending(item)
    getCopilotStore('second').setState({ toolCallsById: store().getState().toolCallsById })
    expect(() => getCopilotStoreForToolCall(item.target.toolCallId)).toThrow('No unique active')
  })
})

describe('canonical history, edits and context', () => {
  it('loads display-only tool history without execution or local transcript writes', async () => {
    const item = pending()
    onCommand = (request) =>
      request.command === 'history.read'
        ? json(
            result(request, {
              status: 'history',
              threadId,
              page: request.page,
              hasMore: false,
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
          )
        : undefined
    await store().getState().selectChat(chat())
    expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
      historical: true,
      state: 'aborted',
    })
    expect(tools.execute).not.toHaveBeenCalled()
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
  it('edits only the exact native message then reads history without a paid replay', async () => {
    setChat()
    await store().getState().editMessage('message', ' exact edit\n')
    expect(commands[0]).toMatchObject({
      command: 'history.edit',
      threadId,
      messageId: 'message',
      text: ' exact edit\n',
    })
    expect(commands.some((request) => request.command === 'message')).toBe(false)
  })
  it('clears prior context synchronously and ignores late context from another model/selection', async () => {
    setChat()
    const late = defer<Response>()
    let first = true
    onCommand = (request) => {
      if (request.command !== 'context.read' || !first) return
      first = false
      return late.promise
    }
    const reading = store().getState().fetchContextUsage()
    expect(store().getState().contextEvidence).toBeNull()
    await store().getState().setSelectedModel('openai/gpt-5.6-sol')
    const original = commands[0]
    late.resolve(
      json(
        result(original, {
          status: 'context',
          threadId,
          contextTokens: 999,
          tokenSource: 'context_estimate',
        })
      )
    )
    await reading
    expect(store().getState().contextEvidence).toMatchObject({
      contextTokens: null,
      tokenSource: 'unavailable',
    })
    expect(commands[0]).not.toHaveProperty('model')
  })
  it.each([true, false])(
    'prunes native context with applied:%s without replacing chat/title financial facts or replaying inference',
    async (applied) => {
      setChat()
      const prior = { ...financial, appliedUsd: '0.12345678901234567890123456789' }
      const priorTitle = {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: 'prior-title-request',
        status: 'completed' as const,
        runId: 'prior-title-run',
        text: 'Existing title',
        financial: { ...financial, appliedUsd: '0.30000000000000001' },
      }
      store().setState({ lastNativeFinancial: prior, lastTitleOutcome: priorTitle })
      const before = store().getState().messages
      onCommand = (request) =>
        request.command === 'context.compact'
          ? json(
              result(request, {
                status: 'compacted',
                threadId,
                applied,
                sourceBoundaryVerified: true,
              })
            )
          : undefined
      await store().getState().compactCurrentContext()
      expect(commands[0]).toMatchObject({
        command: 'context.compact',
        threadId,
        stream: false,
        model: store().getState().selectedModel,
      })
      expect(commands.some((request) => request.command === 'history.read')).toBe(false)
      expect(store().getState().messages).toEqual(before)
      expect(commands.some((request) => request.command === 'message')).toBe(false)
      expect(titleRequests).toEqual([])
      expect(store().getState().lastNativeOutcome).toMatchObject({ status: 'compacted', applied })
      expect(store().getState().lastNativeOutcome).not.toHaveProperty('runId')
      expect(store().getState().lastNativeOutcome).not.toHaveProperty('financial')
      expect(store().getState().lastNativeFinancial).toEqual(prior)
      expect(store().getState().lastTitleOutcome).toEqual(priorTitle)
      expect(store().getState().contextEvidence).not.toHaveProperty('hasObservations')
    }
  )
  it.each(['runId', 'financial', 'usage'])(
    'refuses obsolete compact response field %s without replacing prior finance',
    async (field) => {
      setChat()
      const prior = { ...financial, appliedUsd: '0.30000000000000001' }
      store().setState({ lastNativeFinancial: prior })
      const obsolete = {
        runId,
        financial,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }
      onCommand = (request) =>
        request.command === 'context.compact'
          ? json(
              result(request, {
                status: 'compacted',
                threadId,
                applied: true,
                sourceBoundaryVerified: true,
                [field]: obsolete[field as keyof typeof obsolete],
              })
            )
          : undefined
      await expect(store().getState().compactCurrentContext()).rejects.toThrow()
      expect(store().getState().lastNativeFinancial).toEqual(prior)
      expect(commands.filter((request) => request.command === 'context.compact')).toHaveLength(1)
      expect(commands.some((request) => request.command === 'message')).toBe(false)
      expect(titleRequests).toEqual([])
    }
  )
  it.each([true, false])(
    'terminal context.compacted applied:%s preserves prior model facts',
    async (applied) => {
      setChat()
      const prior = { ...financial, appliedUsd: '0.30000000000000001' }
      store().setState({ lastNativeFinancial: prior, currentRunId: runId })
      const event = await parseNativeContract('CopilotEvent', {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: 'compact-event',
        type: 'context.compacted',
        result: {
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId: 'compact-event',
          status: 'compacted',
          threadId,
          applied,
          sourceBoundaryVerified: true,
        },
      })
      const state = store().getState()
      const patch = applyNativeEvent(state, event, 'unused-message')
      expect(patch).toMatchObject({
        lastNativeOutcome: { status: 'compacted', applied },
        contextEvidence: null,
      })
      expect(patch).not.toHaveProperty('lastNativeFinancial')
      expect(patch).not.toHaveProperty('currentRunId')
      expect({ ...state, ...patch }.lastNativeFinancial).toBe(prior)
      expect(commands).toEqual([])
    }
  )
})

describe('actual bounded initial-title publication', () => {
  const titleOutcome = {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId: 'title-request',
    status: 'completed',
    runId: 'title-run',
    text: '  Generated title  ',
    financial,
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
    expect(store().getState().lastTitleOutcome).toEqual(titleOutcome)
    await store().getState().sendMessage('Second')
    expect(titleRequests).toHaveLength(1)
  })
  it.each([
    ['completed', false],
    ['completed', true],
    ['suspended', false],
    ['suspended', true],
  ] as const)(
    'titles an existing canonical empty thread only after positive empty history and correlated %s terminal (stream=%s)',
    async (status, stream) => {
      store().setState({
        currentChat: { ...chat(), title: '' },
        conversationWorkspaceId: workspaceId,
      })
      let persisted = false
      onCommand = (request) => {
        if (request.command === 'pending.list' && persisted && status === 'suspended')
          return json(
            result(request, {
              status: 'pending_targets',
              items: [pending('approval')],
              page: request.page,
              hasMore: false,
            })
          )
        if (request.command === 'history.read' && !persisted)
          return json(
            result(request, {
              status: 'history',
              threadId,
              items: [],
              page: request.page,
              hasMore: false,
            })
          )
        if (request.command !== 'message') return
        persisted = true
        const terminal =
          status === 'completed' ? ready(request) : suspended(request, [pending('approval')])
        return stream
          ? eventResponse(request, [
              { type: 'response.started', threadId, runId },
              {
                type: status === 'completed' ? 'response.completed' : 'response.suspended',
                result: terminal,
              },
            ])
          : json(terminal)
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
    late.resolve(json(ready(commands.find((request) => request.command === 'message')!)))
    expect(await sending).toBe(true)
    expect(titleRequests).toEqual([])
  })
  it.each([undefined, 0, '0.00', '1e-2'])(
    'does not publish a title with invalid accepted utility money %s',
    async (appliedUsd) => {
      onTitle = () =>
        json({
          title: 'Generated title',
          outcome: { ...titleOutcome, financial: { ...financial, appliedUsd } },
        })
      expect(await store().getState().sendMessage('First')).toBe(true)
      await vi.waitFor(() => expect(titleRequests).toHaveLength(1))
      await vi.waitFor(() => expect(store().getState().error).toBeTruthy())
      expect(commands.some((request) => request.command === 'thread.title')).toBe(false)
      expect(store().getState().lastNativeFinancial).toEqual(financial)
    }
  )
  it('retains exact high precision accepted title facts without numeric conversion', async () => {
    const appliedUsd = '0.12345678901234567890123456789'
    onTitle = () =>
      json({
        title: 'Generated title',
        outcome: { ...titleOutcome, financial: { ...financial, appliedUsd } },
      })
    await store().getState().sendMessage('First')
    await vi.waitFor(() => expect(store().getState().currentChat?.title).toBe('verified title'))
    expect(store().getState().lastTitleOutcome?.financial?.appliedUsd).toBe(appliedUsd)
  })
  it('retains accepted main facts when canonical history readback fails without replaying inference', async () => {
    const appliedUsd = '0.12345678901234567890123456789'
    onCommand = (request) =>
      request.command === 'message'
        ? json({ ...ready(request), financial: { ...financial, appliedUsd } })
        : request.command === 'history.read'
          ? json(
              result(request, {
                status: 'refused',
                error: {
                  code: 'FORBIDDEN',
                  message: 'Current history access denied',
                  retryable: false,
                  uncertain: false,
                },
              }),
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
    expect(store().getState().lastNativeFinancial?.appliedUsd).toBe(appliedUsd)
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
  })
  it('retains accepted title facts on uncertain publication failure without replay or fabricated title', async () => {
    const appliedUsd = '0.12345678901234567890123456789'
    onTitle = () =>
      json({
        title: 'Generated title',
        outcome: { ...titleOutcome, financial: { ...financial, appliedUsd } },
      })
    onCommand = (request) =>
      request.command === 'thread.title'
        ? json(
            result(request, {
              status: 'failed',
              error: {
                code: 'UNCERTAIN',
                message: 'Title publication outcome is uncertain',
                retryable: false,
                uncertain: true,
              },
            }),
            503
          )
        : undefined
    expect(await store().getState().sendMessage('First')).toBe(true)
    await vi.waitFor(() =>
      expect(store().getState().error).toContain('publication outcome is uncertain')
    )
    expect(store().getState().lastTitleOutcome?.financial?.appliedUsd).toBe(appliedUsd)
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
              protocolRevision: COPILOT_NATIVE_REVISION,
              requestId: 'title-request',
              status: mode === 'error' ? 'failed' : mode,
              error: {
                code: 'NATIVE_FAILURE',
                message: 'title unavailable',
                retryable: false,
                uncertain: false,
              },
              uncertain: false,
              financialDisposition: 'accepted',
              financial,
            }
      onTitle = () => json({ title: null, ...(outcome ? { outcome } : {}) })
      await store().getState().sendMessage('First')
      await vi.waitFor(() => expect(titleRequests).toHaveLength(1))
      if (outcome)
        await vi.waitFor(() => expect(store().getState().lastTitleOutcome).toEqual(outcome))
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

describe('owned late pruning and history-edit refresh', () => {
  function controlledTurn() {
    let active: Extract<StudioNativeCommand, { command: 'message' }> | undefined
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let signal: AbortSignal | null | undefined
    const cancelled = vi.fn()
    const text = 'new stream exact output 🔥\n'
    const accepted = { ...financial, appliedUsd: '0.1234567890123456789' }
    const emit = (value: object) => {
      if (!active || !controller) throw new Error('Controlled stream was not started')
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(result(active, value))}\n\n`)
      )
    }
    return {
      text,
      accepted,
      cancelled,
      get signal() {
        return signal
      },
      handle(request: StudioNativeCommand, init?: RequestInit) {
        if (request.command === 'message') {
          active = request
          signal = init?.signal
          return new Response(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value
                emit({ type: 'response.started', threadId: request.threadId, runId })
                emit({ type: 'text.delta', text })
              },
              cancel: cancelled,
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        }
        if (active && request.command === 'history.read' && request.threadId === active.threadId) {
          return json(
            result(request, {
              status: 'history',
              threadId: request.threadId,
              items: [
                {
                  id: 'new-native-user',
                  role: 'user',
                  createdAt: at,
                  parts: [{ type: 'text', text: 'New request' }],
                },
                {
                  id: 'new-native-answer',
                  role: 'assistant',
                  createdAt: at,
                  parts: [{ type: 'text', text }],
                },
              ],
              page: request.page,
              hasMore: false,
            })
          )
        }
      },
      finish() {
        if (!active || !controller) throw new Error('Controlled stream was not started')
        emit({
          type: 'response.completed',
          result: result(active, {
            status: 'completed',
            threadId: active.threadId,
            runId,
            text,
            financial: accepted,
          }),
        })
        controller.close()
      },
    }
  }
  it.each([
    { applied: true, finishBeforeCompact: false },
    { applied: false, finishBeforeCompact: false },
    { applied: true, finishBeforeCompact: true },
    { applied: false, finishBeforeCompact: true },
  ])(
    'ignores old compact result after a distinct new turn: %j',
    async ({ applied, finishBeforeCompact }) => {
      setChat()
      const late = defer<Response>()
      const stream = controlledTurn()
      onCommand = (request, init) =>
        request.command === 'context.compact' ? late.promise : stream.handle(request, init)
      const compacting = store().getState().compactCurrentContext()
      const original = commands[0]
      const sending = store().getState().sendMessage('New request')
      await vi.waitFor(() => expect(store().getState().messages.at(-1)?.content).toBe(stream.text))
      if (finishBeforeCompact) {
        stream.finish()
        expect(await sending).toBe(true)
      }
      const before = store().getState()
      late.resolve(
        json(
          result(original, { status: 'compacted', threadId, applied, sourceBoundaryVerified: true })
        )
      )
      await compacting
      expect(stream.signal?.aborted).toBe(false)
      expect(stream.cancelled).not.toHaveBeenCalled()
      expect(commands.filter((request) => request.command === 'cancel')).toEqual([])
      expect(store().getState().currentChat).toEqual(before.currentChat)
      expect(store().getState().messages).toEqual(before.messages)
      expect(store().getState().lastNativeOutcome).toEqual(before.lastNativeOutcome)
      expect(store().getState().lastNativeFinancial).toEqual(before.lastNativeFinancial)
      if (!finishBeforeCompact) {
        stream.finish()
        expect(await sending).toBe(true)
      }
      expect(store().getState().lastNativeFinancial).toEqual(stream.accepted)
      expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
      expect(titleRequests).toEqual([])
    }
  )
  it('ignores editA result after navigationB and a real new streaming turn', async () => {
    setChat()
    const late = defer<Response>()
    const stream = controlledTurn()
    onCommand = (request, init) =>
      request.command === 'history.edit' ? late.promise : stream.handle(request, init)
    const editing = store().getState().editMessage('message-A', 'edited A')
    const original = commands[0]
    await store().getState().selectChat(chat(null, 'thread-B'))
    const sending = store().getState().sendMessage('New request')
    await vi.waitFor(() => expect(store().getState().messages.at(-1)?.content).toBe(stream.text))
    const before = store().getState()
    late.resolve(
      json(
        result(original, {
          status: 'updated',
          operation: 'history.edit',
          threadId,
          messageId: 'message-A',
        })
      )
    )
    await editing
    expect(store().getState().currentChat).toEqual(chat(null, 'thread-B'))
    expect(store().getState().messages).toEqual(before.messages)
    expect(stream.signal?.aborted).toBe(false)
    expect(stream.cancelled).not.toHaveBeenCalled()
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([])
    expect(
      commands.filter(
        (request) => request.command === 'history.read' && request.threadId === threadId
      )
    ).toEqual([])
    stream.finish()
    expect(await sending).toBe(true)
    expect(store().getState().lastNativeFinancial).toEqual(stream.accepted)
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
  })
  it('discards edit hydration already in flight when a later same-thread turn starts', async () => {
    setChat()
    const lateHistory = defer<Response>()
    const stream = controlledTurn()
    let firstHistory = true
    onCommand = (request, init) => {
      if (request.command === 'history.read' && firstHistory) {
        firstHistory = false
        return lateHistory.promise
      }
      return stream.handle(request, init)
    }
    const editing = store().getState().editMessage('message-A', 'edited A')
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'history.read')).toBe(true)
    )
    const original = commands.find((request) => request.command === 'history.read')!
    const sending = store().getState().sendMessage('New request')
    await vi.waitFor(() => expect(store().getState().messages.at(-1)?.content).toBe(stream.text))
    const before = store().getState()
    lateHistory.resolve(
      json(
        result(original, {
          status: 'history',
          threadId,
          items: history,
          page: { page: 0, perPage: 100 },
          hasMore: false,
        })
      )
    )
    await editing
    expect(store().getState().messages).toEqual(before.messages)
    expect(stream.signal?.aborted).toBe(false)
    expect(stream.cancelled).not.toHaveBeenCalled()
    expect(commands.filter((request) => request.command === 'cancel')).toEqual([])
    stream.finish()
    expect(await sending).toBe(true)
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
    let original: StudioNativeCommand | undefined
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
    message.resolve(json(ready(original!)))
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

describe('reopened workflow pending business context', () => {
  async function reopen(item: Pending) {
    onCommand = (request) =>
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [item],
              page: request.page,
              hasMore: false,
            })
          )
        : undefined
    await store().getState().selectChat(chat(item.financialBinding.workspaceId))
    expect(workflowRequests).toEqual([])
    expect(tools.browser).not.toHaveBeenCalled()
    expect(commands.some((request) => request.command === 'message')).toBe(false)
  }
  const workflowPending = (scope: string | null = workspaceId) => ({
    ...pending('result', 'deploy_workflow'),
    originalArgs: { entityId: 'original-workflow', action: 'deploy', deployType: 'api' },
    financialBinding: { ...pending().financialBinding, workspaceId: scope },
  })
  it.each([workspaceId, null])(
    'restores original authorized entity workspace with conversation %s',
    async (scope) => {
      const item = workflowPending(scope)
      await reopen(item)
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
      expect(workflowRequests).toEqual(['original-workflow'])
      expect(tools.browser).toHaveBeenCalledExactlyOnceWith(item.originalArgs)
      expect(tools.bind).toHaveBeenCalledWith(
        item.target.toolCallId,
        expect.objectContaining({
          contextEntityKind: 'workflow',
          contextEntityId: 'original-workflow',
          workspaceId: 'original-entity-workspace',
        })
      )
      const restored = store().getState().toolCallsById[item.target.toolCallId]
      expect(restored.pending).toEqual(item)
      expect(restored.provenance?.workspaceId).toBe('original-entity-workspace')
      expect(store().getState().conversationWorkspaceId).toBe(scope)
      expect(commands.some((request) => request.command === 'message')).toBe(false)
    }
  )
  it('restores a reopened run tool from the exact original workflow and trigger', async () => {
    const item = {
      ...workflowPending(),
      target: { ...workflowPending().target, toolName: 'run_workflow' },
      originalArgs: {
        entityId: 'original-workflow',
        triggerBlockId: 'original-trigger',
        workflow_input: ' exact input ',
      },
    }
    await reopen(item)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).toHaveBeenCalledExactlyOnceWith(item.originalArgs)
    expect(tools.bind).toHaveBeenCalledWith(
      item.target.toolCallId,
      expect.objectContaining({
        contextEntityId: 'original-workflow',
        workspaceId: 'original-entity-workspace',
      })
    )
    expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
  })
  it.each([
    [403, { error: 'Denied' }],
    [404, { error: 'Missing' }],
    [
      200,
      {
        data: [
          { id: 'original-workflow', workspaceId: 'one' },
          { id: 'other', workspaceId: 'two' },
        ],
      },
    ],
    [200, { data: { id: 'other-workflow', workspaceId: 'original-entity-workspace' } }],
    [200, { data: { id: 'original-workflow', workspaceId: null } }],
  ])('refuses inaccessible or inconsistent target %s/%j', async (status, body) => {
    const item = workflowPending()
    await reopen(item)
    onWorkflow = () => json(body, status)
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.browser).not.toHaveBeenCalled()
    expect(tools.bind).not.toHaveBeenCalled()
    expect(store().getState().error).toContain('could not be verified')
    expect(store().getState().toolCallsById[item.target.toolCallId].pending).toEqual(item)
  })
  it('ignores a late target response after cross-workspace navigation', async () => {
    const item = workflowPending()
    await reopen(item)
    const target = defer<Response>()
    onWorkflow = () => target.promise
    const executing = store().getState().executeCopilotToolCall(item.target.toolCallId)
    await vi.waitFor(() => expect(workflowRequests).toEqual(['original-workflow']))
    await store().getState().createNewChat('new-workspace')
    target.resolve(
      json({ data: { id: 'original-workflow', workspaceId: 'original-entity-workspace' } })
    )
    await executing
    expect(tools.browser).not.toHaveBeenCalled()
    expect(tools.bind).not.toHaveBeenCalled()
    expect(store().getState().conversationWorkspaceId).toBe('new-workspace')
    expect(store().getState().toolCallsById).toEqual({})
  })
})

describe('display-only terminal settlement and optional completed history', () => {
  it.each(['error', 'refused', 'cancel'])(
    'settles tool.display on SSE %s without losing accepted facts',
    async (kind) => {
      setChat()
      onCommand = (request) =>
        request.command === 'message'
          ? eventResponse(request, [
              {
                type: 'tool.display',
                toolName: 'read_workflow',
                toolCallId: 'display-only',
                executionAuthorized: false,
              },
              kind === 'cancel'
                ? {
                    type: 'response.cancel_requested',
                    result: result(request, {
                      status: 'cancel_requested',
                      runId,
                      acknowledged: true,
                      uncertaintyRemains: true,
                    }),
                  }
                : {
                    type: kind === 'error' ? 'response.error' : 'response.refused',
                    result: result(request, {
                      status: kind === 'error' ? 'failed' : 'refused',
                      error: {
                        code: 'FAILED',
                        message: 'Actual terminal refusal',
                        retryable: false,
                        uncertain: false,
                      },
                      financial,
                    }),
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
      expect(tools.execute).not.toHaveBeenCalled()
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
            ? json(ready(request, text))
            : eventResponse(request, [
                { type: 'reasoning.delta', text: reasoning },
                { type: 'text.delta', text },
                { type: 'response.completed', result: ready(request, text) },
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
      expect(before.lastNativeFinancial).toEqual(financial)
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
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId: 'display',
          type: 'tool.display',
          toolCallId: 'display-only',
          toolName: 'read_workflow',
          executionAuthorized: false,
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
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [item],
              page: request.page,
              hasMore: false,
            })
          )
        : undefined
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url) === '/api/workspaces'
        ? json({ workspaces: [{ id: 'chosen-business', name: 'Chosen business' }] })
        : original(url, init)
    )
    return item
  }
  it('requires an explicit new workspace, distinct from personal conversation scope and original financial identity', async () => {
    const item = drive()
    item.financialBinding.workspaceId = null
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
    expect(tools.execute).not.toHaveBeenCalled()
  })
  it('routes an explicitly chosen credential through authorized readback and then original native proof delivery', async () => {
    const item = prepare()
    await store().getState().authorizeToolWorkspace(item.target.toolCallId, 'chosen-business')
    tools.execute.mockResolvedValue({
      success: true,
      result: { credentialId: 'explicit-credential' },
      proof: 'actual-proof-seam',
    })
    await store()
      .getState()
      .readbackCopilotToolCall(item.target.toolCallId, { credentialId: 'explicit-credential' })
    expect(tools.execute).toHaveBeenCalledExactlyOnceWith({
      native: { workspaceId, target: item.target },
      action: 'readback',
      context: { workspaceId: 'chosen-business' },
      readback: { credentialId: 'explicit-credential' },
    })
    expect(commands.filter((x) => x.command === 'tool.result')).toEqual([
      expect.objectContaining({
        target: item.target,
        result: { credentialId: 'explicit-credential' },
        proof: 'actual-proof-seam',
        source: 'studio_signed',
      }),
    ])
    expect(commands.filter((x) => x.command === 'message')).toEqual([])
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
    expect(tools.execute).not.toHaveBeenCalled()
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
      expect(tools.execute).not.toHaveBeenCalled()
    }
  )
})

describe('submitted immutable draft ownership', () => {
  it.each([
    'unchanged',
    'text',
    'contexts',
    'ABA',
    'navigation',
    'abort',
    'failure',
    'programmatic',
  ])('preserves later draft ownership: %s', async (kind) => {
    setChat()
    const submitted = { text: 'submitted', contexts: [] }
    store().getState().setDraft(submitted)
    const held = defer<Response>()
    onCommand = (request) => (request.command === 'message' ? held.promise : undefined)
    const sending = store()
      .getState()
      .sendMessage('submitted', kind === 'programmatic' ? {} : { submittedDraft: submitted })
    await vi.waitFor(() =>
      expect(commands.some((request) => request.command === 'message')).toBe(true)
    )
    if (kind === 'text')
      store()
        .getState()
        .setDraft({ ...submitted, text: 'next draft' })
    if (kind === 'contexts')
      store()
        .getState()
        .setDraft({
          ...submitted,
          contexts: [{ kind: 'workflow', workflowId: 'next', label: 'Next workflow' }],
        })
    if (kind === 'ABA') {
      store()
        .getState()
        .setDraft({ ...submitted, text: 'temporary' })
      store()
        .getState()
        .setDraft({ ...submitted })
    }
    if (kind === 'navigation') await store().getState().selectChat(chat('other', 'other'))
    if (kind === 'abort') store().getState().abortMessage()
    const next = store().getState().draft
    const request = commands.find((request) => request.command === 'message')!
    held.resolve(kind === 'failure' ? json({ error: 'failed' }, 500) : json(ready(request)))
    const accepted = await sending
    if (kind === 'unchanged') expect(store().getState().draft).toEqual({ text: '', contexts: [] })
    else expect(store().getState().draft).toBe(next)
    if (['navigation', 'abort', 'failure'].includes(kind)) expect(accepted).toBe(false)
    expect(commands.filter((request) => request.command === 'message')).toHaveLength(1)
  })
})

describe('R5 command-specific streamed outcomes', () => {
  it.each([true, false])(
    'rejects message compacted applied:%s before completion effects',
    async (applied) => {
      setChat()
      onCommand = (request) =>
        request.command === 'message'
          ? eventResponse(request, [
              {
                type: 'context.compacted',
                result: result(request, {
                  status: 'compacted',
                  threadId,
                  applied,
                  sourceBoundaryVerified: true,
                }),
              },
            ])
          : undefined
      expect(await store().getState().sendMessage('ordinary message')).toBe(false)
      expect(store().getState().lastNativeOutcome).toMatchObject({
        status: 'failed',
        error: { code: 'UNCERTAIN', uncertain: true, retryable: false },
      })
      expect(store().getState().lastNativeFinancial).toBeNull()
      expect(commands.map((request) => request.command)).toEqual(['message'])
      expect(tools.execute).not.toHaveBeenCalled()
      expect(tools.browser).not.toHaveBeenCalled()
      expect(titleRequests).toEqual([])
    }
  )
  it('retains rendered output and accepted facts when a tool continuation receives a compacted terminal', async () => {
    const item = pending('result', 'oauth_request_access')
    item.originalArgs = { providerName: 'Google Drive' }
    installPending(item)
    const paid = { ...financial, appliedUsd: '0.1234567890123456789' }
    store().setState({ lastNativeFinancial: paid })
    onCommand = (request) => {
      if (request.command === 'pending.list')
        return json(
          result(request, {
            status: 'pending_targets',
            items: [item],
            page: request.page,
            hasMore: false,
          })
        )
      if (request.command === 'tool.result')
        return eventResponse(request, [
          { type: 'text.delta', text: 'known completed output' },
          {
            type: 'context.compacted',
            result: result(request, {
              status: 'compacted',
              threadId,
              applied: false,
              sourceBoundaryVerified: true,
            }),
          },
        ])
      return undefined
    }
    await expect(
      store()
        .getState()
        .submitBrowserAssertion(item.target.toolCallId, {
          kind: 'ui.opened',
          data: { opened: true, surface: 'integrations', message: 'Opened' },
        })
    ).rejects.toThrow('not verified')
    expect(store().getState().lastNativeFinancial).toEqual(paid)
    expect(
      store()
        .getState()
        .messages.some((message) => message.content.includes('known completed output'))
    ).toBe(true)
    expect(store().getState().lastNativeOutcome).toMatchObject({ status: 'failed' })
    expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(1)
    expect(
      commands.some(
        (request) => request.command === 'message' || request.command === 'context.compact'
      )
    ).toBe(false)
    expect(tools.browser).not.toHaveBeenCalled()
    expect(tools.execute).not.toHaveBeenCalled()
  })
})

describe('R5 reopened OAuth workspace authorization', () => {
  const oauth = (scope: string | null = null) => ({
    ...pending('result', 'oauth_request_access'),
    originalArgs: { providerName: 'Google Drive' },
    financialBinding: { ...pending().financialBinding, workspaceId: scope },
  })
  let allowed: Array<{ id: string; name: string }>
  async function reopen(item = oauth()) {
    allowed = [
      { id: 'chosen-business', name: 'Chosen business' },
      { id: 'original-entity-workspace', name: 'Original business' },
    ]
    onCommand = (request) => {
      if (request.command === 'pending.list')
        return json(
          result(request, {
            status: 'pending_targets',
            items: [item],
            page: request.page,
            hasMore: false,
          })
        )
      if (request.command === 'tool.approve') {
        item.stage = 'result'
        return json(suspended(request, [item]))
      }
      return undefined
    }
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url) === '/api/workspaces'
        ? Promise.resolve(json({ workspaces: allowed }))
        : original(url, init)
    )
    await store().getState().selectChat(chat(item.financialBinding.workspaceId))
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
    expect(item.financialBinding.workspaceId).toBeNull()
  })
  it('freshly resolves an actual original workflow locator without substituting conversation workspace', async () => {
    const item = await reopen()
    store().setState((state) => ({
      toolCallsById: {
        ...state.toolCallsById,
        [item.target.toolCallId]: {
          ...state.toolCallsById[item.target.toolCallId],
          provenance: {
            contextEntityKind: 'workflow',
            contextEntityId: 'actual-original-workflow',
          },
        },
      },
    }))
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(workflowRequests).toEqual(['actual-original-workflow'])
    expect(tools.bind).toHaveBeenCalledWith(
      item.target.toolCallId,
      expect.objectContaining({
        workspaceId: 'original-entity-workspace',
        contextEntityKind: 'workflow',
        contextEntityId: 'actual-original-workflow',
      })
    )
    expect(store().getState().currentChat?.workspaceId).toBeNull()
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
    (['display-first', 'pending-first', 'json'] as const).flatMap((order) =>
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
      }
      const watchlist = {
        ...pending('approval', 'read_watchlist'),
        target: { ...pending().target, toolCallId: 'watchlist-call', toolName: 'read_watchlist' },
        originalArgs: { entityId: 'watchlist-b' },
      }
      const items = [layout, watchlist]
      onCommand = (request) => {
        if (request.command === 'pending.list')
          return json(
            result(request, {
              status: 'pending_targets',
              items,
              page: request.page,
              hasMore: false,
            })
          )
        if (request.command === 'message') {
          if (order === 'json') return json(suspended(request, items))
          const displays = items.map((item) => ({
            type: 'tool.display',
            toolCallId: item.target.toolCallId,
            toolName: item.target.toolName,
            executionAuthorized: false,
          }))
          const pendings = items.map((item) => ({ type: 'tool.pending', pending: item, financial }))
          return eventResponse(request, [
            { type: 'response.started', threadId, runId },
            ...(order === 'display-first'
              ? [...displays, ...pendings]
              : [...pendings, ...displays]),
            { type: 'response.suspended', result: suspended(request, items) },
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
            protocolRevision: COPILOT_NATIVE_REVISION,
            requestId: 'later',
            type: 'tool.display',
            toolCallId: item.target.toolCallId,
            toolName: item.target.toolName,
            executionAuthorized: false,
          },
          'unused',
          { workspaceId: 'workspace-c' }
        )
        expect(unchanged).toEqual({})
      }
      const item = items[selectedIndex]
      item.stage = 'result'
      tools.execute.mockResolvedValue({
        success: true,
        result: { scope: 'recorded' },
        proof: 'actual-proof-seam',
      })
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
      expect(tools.execute).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          native: { workspaceId, target: item.target },
          context: expected[selectedIndex],
        })
      )
      expect(store().getState().conversationWorkspaceId).toBe(workspaceId)
    }
  )
})

describe('owned workflow chat deployment UI', () => {
  const prepareChatDeployment = () => {
    const item: Pending = {
      ...pending('result', 'deploy_workflow'),
      originalArgs: { action: 'deploy', deployType: 'chat', entityId: 'target-a' },
      financialBinding: { ...pending().financialBinding, workspaceId: null },
    }
    installPending(item)
    store().setState({ currentChat: chat(null), conversationWorkspaceId: null })
    onCommand = (request) =>
      request.command === 'pending.list'
        ? json(
            result(request, {
              status: 'pending_targets',
              items: [item],
              page: request.page,
              hasMore: false,
            })
          )
        : undefined
    return item
  }
  const open = () =>
    store().getState().openWorkflowChatDeployment('call-fixture', {
      workflowId: 'target-a',
      workspaceId: 'original-entity-workspace',
    })

  it('awaits the target form and records known opened before resolving, without changing native or financial scope', async () => {
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
    expect(tools.execute).not.toHaveBeenCalled()
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

describe('R8 originating action, automatic freshness and signed review decisions', () => {
  const pendingResponse = (request: StudioNativeCommand, items: Pending[]) =>
    json(
      result(request, {
        status: 'pending_targets',
        items,
        page: 'page' in request ? request.page : { page: 0, perPage: 100 },
        hasMore: false,
      })
    )

  it.each(['limited', 'full-after-preview'] as const)(
    'keeps a genuine preview explicit through unrelated read refreshes: %s',
    async (policy) => {
      setChat()
      const edit = pending('result', 'edit_workflow')
      const reads = ['read-a', 'read-b', 'read-c'].map((id) => {
        const item = pending('result', 'search_online')
        item.target.toolCallId = id
        item.originalArgs = { query: id }
        return item
      })
      let remaining = [edit, ...reads]
      onCommand = (request) => {
        if (request.command === 'message') return json(suspended(request, remaining))
        if (request.command === 'pending.list') return pendingResponse(request, remaining)
        if (request.command === 'tool.result') {
          remaining = remaining.filter(
            (item) => item.target.toolCallId !== request.target.toolCallId
          )
          return json(remaining.length ? suspended(request, remaining) : ready(request))
        }
        return undefined
      }
      tools.execute.mockImplementation(async (input) => {
        if (input.native.target.toolName === 'edit_workflow') {
          if (policy === 'full-after-preview') store().setState({ accessLevel: 'full' })
          return { success: true, result: { requiresReview: true, reviewToken: 'review-token' } }
        }
        return { success: true, result: { results: [] }, proof: 'read-proof' }
      })
      tools.accept.mockResolvedValue({
        success: true,
        result: { success: true },
        proof: 'accept-proof',
      })
      expect(await store().getState().sendMessage('Prepare an edit and read')).toBe(true)
      await vi.waitFor(() =>
        expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(3)
      )
      expect(tools.execute).toHaveBeenCalledTimes(4)
      expect(tools.accept).not.toHaveBeenCalled()
      expect(store().getState().toolCallsById[edit.target.toolCallId]).toMatchObject({
        state: ClientToolCallState.review,
        result: { reviewToken: 'review-token' },
      })
      const projected = store()
        .getState()
        .messages.flatMap((message) => message.contentBlocks ?? [])
        .find((block) => block.type === 'tool_call' && block.toolCall.id === edit.target.toolCallId)
      expect(projected).toMatchObject({ toolCall: { state: ClientToolCallState.review } })
      await store().getState().executeCopilotToolCall(edit.target.toolCallId)
      expect(tools.accept).toHaveBeenCalledOnce()
      expect(tools.execute).toHaveBeenCalledTimes(4)
      expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(4)
    }
  )

  it.each(['limited', 'full'] as const)(
    'one explicit Allow continues the same make_api_request once in %s mode',
    async (accessLevel) => {
      const item = pending('approval', 'make_api_request')
      item.originalArgs = { url: 'https://example.test', method: 'GET' }
      installPending(item)
      store().setState({ accessLevel })
      onCommand = (request) => {
        if (request.command === 'pending.list') return pendingResponse(request, [item])
        if (request.command === 'tool.approve') {
          item.stage = 'result'
          return json(suspended(request, [item]))
        }
        return undefined
      }
      tools.execute.mockResolvedValue({
        success: true,
        result: { status: 200, data: 'actual synthetic HTTP result' },
        proof: 'proof',
      })
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(commands.filter((request) => request.command === 'tool.approve')).toHaveLength(1)
      expect(tools.execute).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          native: { workspaceId, target: item.target },
          action: 'execute',
          accessLevel,
        })
      )
      expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(1)
    }
  )

  it('continues an explicit original action after fresh native approval already advanced without approving again', async () => {
    const original = pending('approval', 'make_api_request')
    original.originalArgs = { url: 'https://example.test', method: 'GET' }
    installPending(structuredClone(original))
    const current = { ...structuredClone(original), stage: 'result' as const }
    onCommand = (request) =>
      request.command === 'pending.list' ? pendingResponse(request, [current]) : undefined
    tools.execute.mockResolvedValue({
      success: true,
      result: { status: 200, data: 'authorized result' },
      proof: 'proof',
    })
    await store().getState().executeCopilotToolCall(original.target.toolCallId)
    expect(commands.some((request) => request.command === 'tool.approve')).toBe(false)
    expect(tools.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        native: { workspaceId, target: current.target },
        action: 'execute',
      })
    )
    expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(1)
  })

  it('native Allow prepares a gated limited preview and does not also accept it', async () => {
    const item = pending('approval', 'create_workflow')
    item.originalArgs = { name: 'Proposed workflow', workspaceId }
    installPending(item)
    onCommand = (request) => {
      if (request.command === 'pending.list') return pendingResponse(request, [item])
      if (request.command === 'tool.approve') {
        item.stage = 'result'
        return json(suspended(request, [item]))
      }
      return undefined
    }
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'create-preview' },
    })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(tools.accept).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[item.target.toolCallId].state).toBe(
      ClientToolCallState.review
    )
    expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
  })

  it.each(['target', 'originalArgs', 'financialBinding', 'financialOccurrence'] as const)(
    'does not continue approval after %s changes',
    async (field) => {
      const item = pending('approval', 'make_api_request')
      item.originalArgs = { url: 'https://example.test', method: 'GET' }
      installPending(item)
      const changed = structuredClone(item)
      changed.stage = 'result'
      if (field === 'target') changed.target.runId = 'other-run'
      if (field === 'originalArgs') changed.originalArgs.url = 'https://other.test'
      if (field === 'financialBinding') changed.financialBinding.fingerprint = 'other'
      if (field === 'financialOccurrence') changed.financialOccurrence.retryCount++
      let approved = false
      onCommand = (request) => {
        if (request.command === 'pending.list')
          return pendingResponse(request, [approved ? changed : item])
        if (request.command === 'tool.approve') {
          approved = true
          return json(suspended(request, [changed]))
        }
        return undefined
      }
      await store().getState().executeCopilotToolCall(item.target.toolCallId)
      expect(tools.execute).not.toHaveBeenCalled()
      expect(tools.browser).not.toHaveBeenCalled()
      expect(commands.some((request) => request.command === 'tool.result')).toBe(false)
    }
  )

  it('suppresses a queued automatic initial action when a genuine preview appears before fresh dispatch', async () => {
    setChat()
    const item = pending('result', 'edit_workflow')
    const entered = defer<void>()
    const delayed = defer<Response>()
    let calls = 0
    onCommand = (request) => {
      if (request.command === 'message') return json(suspended(request, [item]))
      if (request.command === 'pending.list') {
        if (++calls === 2) {
          entered.resolve()
          return delayed.promise
        }
        return pendingResponse(request, [item])
      }
      return undefined
    }
    const sending = store().getState().sendMessage('Prepare edit')
    await entered.promise
    const call = store().getState().toolCallsById[item.target.toolCallId]
    const review = {
      ...call,
      state: ClientToolCallState.review,
      result: { requiresReview: true, reviewToken: 'new-preview' },
    }
    store().setState({ toolCallsById: { [call.id]: review } })
    const request = commands.filter((command) => command.command === 'pending.list').at(-1)!
    delayed.resolve(pendingResponse(request, [item]))
    await sending
    await vi.waitFor(() =>
      expect(store().getState().toolCallsById[call.id].state).toBe(ClientToolCallState.review)
    )
    expect(tools.execute).not.toHaveBeenCalled()
    expect(tools.accept).not.toHaveBeenCalled()
  })

  it('rejects one genuine preview through signed delivery while unrelated work remains pending', async () => {
    const edit = pending('result', 'edit_workflow')
    const other = pending('approval', 'make_api_request')
    other.target.toolCallId = 'unrelated'
    installPending(edit)
    let remaining = [edit, other]
    onCommand = (request) => {
      if (request.command === 'pending.list') return pendingResponse(request, remaining)
      if (request.command === 'tool.result') {
        remaining = [other]
        return json(suspended(request, remaining))
      }
      return undefined
    }
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'token' },
    })
    const rejection = { success: false, rejected: true, toolName: 'edit_workflow' }
    tools.reject.mockResolvedValue({ success: true, result: rejection, proof: 'rejected-proof' })
    await store().getState().executeCopilotToolCall(edit.target.toolCallId)
    await store().getState().skipCopilotToolCall(edit.target.toolCallId)
    expect(tools.reject).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        native: { workspaceId, target: edit.target },
        reviewToken: 'token',
      })
    )
    expect(commands.find((request) => request.command === 'tool.result')).toMatchObject({
      source: 'studio_signed',
      target: edit.target,
      result: rejection,
      proof: 'rejected-proof',
      financialBinding: edit.financialBinding,
    })
    expect(
      commands.some((request) => request.command === 'cancel' || request.command === 'tool.decline')
    ).toBe(false)
    expect(tools.accept).not.toHaveBeenCalled()
    expect(tools.refresh).not.toHaveBeenCalled()
    expect(remaining).toEqual([other])
    expect(store().getState().isAwaitingContinuation).toBe(true)
  })

  it('retains a known rejection/proof after native ACK loss and retries signed delivery without another decision', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    let deliver = false
    onCommand = (request) =>
      request.command === 'pending.list'
        ? pendingResponse(request, [item])
        : request.command === 'tool.result' && !deliver
          ? Promise.reject(new Error('native ACK lost'))
          : undefined
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'token' },
    })
    const result = { success: false, rejected: true, toolName: 'edit_workflow' }
    tools.reject.mockResolvedValue({ success: true, result, proof: 'known-proof' })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    await expect(store().getState().skipCopilotToolCall(item.target.toolCallId)).rejects.toThrow(
      'not verified'
    )
    expect(store().getState().toolCallsById[item.target.toolCallId]).toMatchObject({
      state: ClientToolCallState.error,
      result,
      resultProof: 'known-proof',
      resultDeliveryError: expect.any(String),
    })
    deliver = true
    await store().getState().retryToolResultDelivery(item.target.toolCallId)
    expect(tools.reject).toHaveBeenCalledOnce()
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(tools.accept).not.toHaveBeenCalled()
    expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(2)
    expect(commands.some((request) => request.command === 'cancel')).toBe(false)
  })

  it('an uncertain rejection HTTP reply cannot become a new Accept or Reject attempt', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    onCommand = (request) =>
      request.command === 'pending.list' ? pendingResponse(request, [item]) : undefined
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'token' },
    })
    tools.reject.mockRejectedValue(new Error('decision HTTP reply lost'))
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    await expect(store().getState().skipCopilotToolCall(item.target.toolCallId)).rejects.toThrow(
      'HTTP reply lost'
    )
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    await expect(store().getState().skipCopilotToolCall(item.target.toolCallId)).rejects.toThrow()
    expect(tools.reject).toHaveBeenCalledOnce()
    expect(tools.accept).not.toHaveBeenCalled()
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(store().getState().toolCallsById[item.target.toolCallId].resultProof).toBeUndefined()
    expect(
      commands.some((request) => request.command === 'cancel' || request.command === 'tool.result')
    ).toBe(false)
  })
  it.each(['error', 'success', 'rejected', 'aborted', 'background', 'executing'] as const)(
    'does not reset/automatically dispatch retained %s state on Pending refresh',
    async (state) => {
      const item = pending('result', 'edit_workflow')
      installPending(item)
      const call = {
        ...store().getState().toolCallsById[item.target.toolCallId],
        state: ClientToolCallState[state],
        result: { retained: 'known previous work' },
      }
      store().setState({
        toolCallsById: { [call.id]: call },
        messages: [
          {
            id: 'earlier-assistant',
            role: 'assistant',
            content: '',
            timestamp: at,
            contentBlocks: [{ type: 'tool_call', toolCall: call, timestamp: Date.now() }],
          },
        ],
      })
      onCommand = (request) =>
        request.command === 'message'
          ? json(suspended(request, [item]))
          : request.command === 'pending.list'
            ? pendingResponse(request, [item])
            : undefined
      await store().getState().sendMessage('Observe existing pending')
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(tools.execute).not.toHaveBeenCalled()
      expect(tools.accept).not.toHaveBeenCalled()
      expect(store().getState().toolCallsById[call.id]).toMatchObject({
        state,
        result: { retained: 'known previous work' },
      })
      expect(store().getState().messages[0].contentBlocks?.[0]).toMatchObject({
        toolCall: { state },
      })
    }
  )

  it.each(['failed HTTP', 'missing proof'] as const)(
    'does not retry a prior initial attempt after another read refresh: %s',
    async (failure) => {
      setChat()
      const edit = pending('result', 'edit_workflow')
      const read = pending('result', 'search_online')
      read.target.toolCallId = 'other-read'
      read.originalArgs = { query: 'other' }
      let remaining = [edit, read]
      onCommand = (request) => {
        if (request.command === 'message') return json(suspended(request, remaining))
        if (request.command === 'pending.list') return pendingResponse(request, remaining)
        if (request.command === 'tool.result') {
          remaining = [edit]
          return json(suspended(request, remaining))
        }
        return undefined
      }
      tools.execute.mockImplementation(async (input) => {
        if (input.native.target.toolName === 'edit_workflow') {
          if (failure === 'failed HTTP') throw new Error('uncertain business reply')
          return { success: true, result: { completed: 'known business output' } }
        }
        return { success: true, result: { results: [] }, proof: 'read-proof' }
      })
      await store().getState().sendMessage('Initial attempts')
      await vi.waitFor(() =>
        expect(commands.filter((request) => request.command === 'tool.result')).toHaveLength(1)
      )
      expect(tools.execute).toHaveBeenCalledTimes(2)
      expect(tools.accept).not.toHaveBeenCalled()
      expect(store().getState().toolCallsById[edit.target.toolCallId].state).toBe(
        ClientToolCallState.error
      )
    }
  )

  it('a queued initial click cannot turn into acceptance of a later displayed preview', async () => {
    const first = pending('result', 'search_online')
    first.originalArgs = { query: 'first' }
    const edit = pending('result', 'edit_workflow')
    edit.target.toolCallId = 'queued-edit'
    installPending(first)
    store().setState({
      toolCallsById: {
        ...store().getState().toolCallsById,
        [edit.target.toolCallId]: {
          id: edit.target.toolCallId,
          name: edit.target.toolName,
          state: ClientToolCallState.pending,
          params: edit.originalArgs,
          pending: edit,
        },
      },
    })
    const entered = defer<void>()
    const release = defer<{ success: true; result: { results: never[] }; proof: string }>()
    onCommand = (request) =>
      request.command === 'pending.list'
        ? pendingResponse(request, [first, edit])
        : request.command === 'tool.result'
          ? json(suspended(request, [edit]))
          : undefined
    tools.execute.mockImplementation(async () => {
      entered.resolve()
      return release.promise
    })
    const executing = store().getState().executeCopilotToolCall(first.target.toolCallId)
    await entered.promise
    const queued = store().getState().executeCopilotToolCall(edit.target.toolCallId)
    const call = store().getState().toolCallsById[edit.target.toolCallId]
    store().setState({
      toolCallsById: {
        ...store().getState().toolCallsById,
        [call.id]: {
          ...call,
          state: ClientToolCallState.review,
          result: { requiresReview: true, reviewToken: 'later-preview' },
        },
      },
    })
    release.resolve({ success: true, result: { results: [] }, proof: 'first-proof' })
    await Promise.all([executing, queued])
    expect(tools.execute).toHaveBeenCalledOnce()
    expect(tools.accept).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[call.id]).toMatchObject({
      state: ClientToolCallState.review,
      result: { reviewToken: 'later-preview' },
    })
  })

  it('a concurrent Reject cannot resolve as rejected while an Accept owns the action', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    onCommand = (request) =>
      request.command === 'pending.list' ? pendingResponse(request, [item]) : undefined
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'token' },
    })
    await store().getState().executeCopilotToolCall(item.target.toolCallId)
    const entered = defer<void>()
    const release = defer<{ success: true; result: { success: true }; proof: string }>()
    tools.accept.mockImplementation(async () => {
      entered.resolve()
      return release.promise
    })
    const accepting = store().getState().executeCopilotToolCall(item.target.toolCallId)
    await entered.promise
    await expect(store().getState().skipCopilotToolCall(item.target.toolCallId)).rejects.toThrow(
      'in flight'
    )
    expect(tools.reject).not.toHaveBeenCalled()
    expect(store().getState().toolCallsById[item.target.toolCallId].state).not.toBe(
      ClientToolCallState.rejected
    )
    release.resolve({ success: true, result: { success: true }, proof: 'accepted' })
    await accepting
    expect(tools.accept).toHaveBeenCalledOnce()
  })

  it('restores a historical shell for manual preview but never auto-dispatches it under full access', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    const call = store().getState().toolCallsById[item.target.toolCallId]
    store().setState({
      accessLevel: 'full',
      toolCallsById: {
        [call.id]: {
          ...call,
          pending: undefined,
          historical: true,
          state: ClientToolCallState.aborted,
        },
      },
    })
    onCommand = (request) =>
      request.command === 'pending.list'
        ? pendingResponse(request, [item])
        : request.command === 'message'
          ? json(suspended(request, [item]))
          : undefined
    await store().getState().readPendingTool(call.id)
    expect(store().getState().toolCallsById[call.id]).toMatchObject({
      state: ClientToolCallState.pending,
      historical: false,
      historyOrigin: true,
      pending: item,
    })
    await store().getState().sendMessage('Observe retained work')
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(tools.execute).not.toHaveBeenCalled()
    expect(tools.browser).not.toHaveBeenCalled()
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'fresh-manual-preview' },
    })
    await store().getState().executeCopilotToolCall(call.id)
    expect(tools.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'execute', accessLevel: 'limited' })
    )
    expect(store().getState().toolCallsById[call.id]).toMatchObject({
      state: ClientToolCallState.review,
      historyOrigin: true,
    })
    expect(tools.accept).not.toHaveBeenCalled()
  })

  it('keeps conversation billing A separate from original business B through preview and rejection', async () => {
    const item = pending('result', 'edit_workflow')
    installPending(item)
    const call = store().getState().toolCallsById[item.target.toolCallId]
    store().setState({
      toolCallsById: {
        [call.id]: {
          ...call,
          provenance: {
            contextEntityKind: 'workflow',
            contextEntityId: 'original-workflow',
            workspaceId: 'business-B',
          },
        },
      },
    })
    onCommand = (request) =>
      request.command === 'pending.list' ? pendingResponse(request, [item]) : undefined
    tools.execute.mockResolvedValue({
      success: true,
      result: { requiresReview: true, reviewToken: 'token-B' },
    })
    tools.reject.mockResolvedValue({
      success: true,
      result: { success: false, rejected: true, toolName: 'edit_workflow' },
      proof: 'original-proof-B',
    })
    await store().getState().executeCopilotToolCall(call.id)
    await store().getState().skipCopilotToolCall(call.id)
    expect(tools.reject).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        native: { workspaceId, target: item.target },
        context: {
          contextEntityKind: 'workflow',
          contextEntityId: 'original-workflow',
          workspaceId: 'business-B',
        },
      })
    )
    expect(commands.find((request) => request.command === 'tool.result')).toMatchObject({
      financialBinding: item.financialBinding,
      workspaceId,
    })
  })
})
