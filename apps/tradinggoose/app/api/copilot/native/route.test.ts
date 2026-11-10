/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotEvent, Pending } from '@/lib/copilot/native/contract'
import { COPILOT_NATIVE_REVISION } from '@/lib/copilot/native/contract'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { readNativeEvents } from '@/lib/copilot/native/stream'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  scope: vi.fn(),
  pending: vi.fn(),
  access: vi.fn(),
  fetch: vi.fn(),
  proof: vi.fn(),
  manifest: vi.fn(),
  contexts: vi.fn(),
  images: vi.fn(),
  history: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: m.session }))
vi.mock('@/lib/copilot/native/business-access', () => ({ authorizeNativeBusinessResult: m.access }))
vi.mock('@/lib/copilot/native/target', () => ({
  NativeTargetError: class NativeTargetError extends Error {
    constructor(
      message: string,
      public status = 409
    ) {
      super(message)
    }
  },
  authorizeNativeConversationScope: m.scope,
  resolveNativePendingTarget: m.pending,
}))
vi.mock('@/lib/copilot/native/client', () => ({ fetchNativeCopilot: m.fetch }))
vi.mock('@/lib/copilot/result-proof', () => ({ verifyCopilotToolResultProof: m.proof }))
vi.mock('@/lib/copilot/runtime-models', () => ({ COPILOT_RUNTIME_MODELS: ['test/model'] }))
vi.mock('@/lib/copilot/runtime-tool-manifest', () => ({
  getCopilotRuntimeToolManifest: m.manifest,
}))
vi.mock('@/lib/copilot/process-contents', () => ({ processContextsServer: m.contexts }))
vi.mock('@/lib/copilot/native/images', () => ({ prepareNativeImageParts: m.images }))
vi.mock('@/lib/copilot/native/history', () => ({ readNativeThreadHistory: m.history }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: vi.fn() }))
const scope = { actorUserId: 'actual-actor', workspaceId: null }
const requestId = 'browser-request'
function pending(): Pending {
  return {
    target: {
      resourceId: nativeConversationIdentity(scope).resourceId,
      threadId: 'thread',
      runId: 'run',
      toolCallId: 'call',
      toolName: 'search_online',
    },
    stage: 'result',
    originalArgs: { query: 'query' },
    financialBinding: {
      namespace: 'billing',
      key: 'key',
      fingerprint: 'fingerprint',
      actorUserId: 'actual-actor',
      workspaceId: null,
      workflowId: null,
      runId: 'run',
      purpose: 'copilot',
    },
    financialOccurrence: { stepNumber: 4, retryCount: 0 },
  }
}
function list() {
  return { requestId, workspaceId: null, command: 'threads.list', page: { page: 0, perPage: 100 } }
}
function response() {
  return {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'threads',
    items: [],
    page: { page: 0, perPage: 100 },
    hasMore: false,
  }
}
function completed() {
  return {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'completed',
    runId: 'run',
    threadId: 'thread',
    text: 'Hello',
    financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0' },
  }
}
async function post(body: unknown) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.test/api/copilot/native', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
}
function eventResponse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream', 'x-private-sdk-header': 'never-forward' },
  })
}
async function copilotEvents(response: Response): Promise<CopilotEvent[]> {
  if (!response.body) throw new Error('Expected the actual proxy SSE body')
  const events: CopilotEvent[] = []
  for await (const event of readNativeEvents(response.body, 'CopilotEvent', { requestId }))
    events.push(event)
  return events
}
beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'actual-actor' } })
  m.scope.mockResolvedValue(scope)
  m.pending.mockImplementation(async () => pending())
  m.fetch.mockImplementation(async (input: { command: string }) =>
    Response.json(input.command === 'threads.list' ? response() : completed(), {
      headers: { 'x-private-sdk-header': 'never-forward' },
    })
  )
  m.manifest.mockResolvedValue({ version: 'v1', tools: [] })
  m.contexts.mockResolvedValue([])
})
describe('authenticated native Copilot facade', () => {
  it.each([true, false])(
    'delegates only authorized deterministic compaction, applied=%s',
    async (applied) => {
      const compacted = {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'compacted',
        threadId: 'thread',
        applied,
        sourceBoundaryVerified: true,
      }
      m.fetch.mockResolvedValueOnce(Response.json(compacted))
      const input = {
        requestId,
        workspaceId: null,
        command: 'context.compact',
        threadId: 'thread',
        model: 'test/model',
        stream: false,
      }
      const result = await post(input)
      expect(result.status).toBe(200)
      expect(await result.json()).toEqual(compacted)
      expect(m.fetch).toHaveBeenCalledExactlyOnceWith(
        {
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId,
          scope,
          command: 'context.compact',
          threadId: 'thread',
          model: 'test/model',
          stream: false,
        },
        expect.any(AbortSignal)
      )
      for (const helper of [
        m.pending,
        m.proof,
        m.manifest,
        m.contexts,
        m.images,
        m.history,
        m.access,
      ]) {
        expect(helper).not.toHaveBeenCalled()
      }
    }
  )
  it.each([
    { contextTokens: 0, tokenSource: 'context_estimate' },
    { contextTokens: 42, tokenSource: 'active_native_usage' },
    { contextTokens: null, tokenSource: 'unavailable' },
  ])(
    'retains truthful context evidence without observations or inference metadata: %j',
    async (evidence) => {
      const context = {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'context',
        threadId: 'thread',
        ...evidence,
      }
      m.fetch.mockResolvedValueOnce(Response.json(context))
      const result = await post({
        requestId,
        workspaceId: null,
        command: 'context.read',
        threadId: 'thread',
      })
      expect(result.status).toBe(200)
      expect(await result.json()).toEqual(context)
      expect(m.fetch).toHaveBeenCalledOnce()
      for (const helper of [
        m.pending,
        m.proof,
        m.manifest,
        m.contexts,
        m.images,
        m.history,
        m.access,
      ])
        expect(helper).not.toHaveBeenCalled()
    }
  )
  it('relays streamed pruning through the actual canonical terminal validator', async () => {
    const event = {
      type: 'context.compacted',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      result: {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'compacted',
        threadId: 'thread',
        applied: false,
        sourceBoundaryVerified: true,
      },
    }
    const wire = `data: ${JSON.stringify(event)}\n\n`
    m.fetch.mockResolvedValueOnce(
      new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } })
    )
    const result = await post({
      requestId,
      workspaceId: null,
      command: 'context.compact',
      threadId: 'thread',
      model: 'test/model',
      stream: true,
    })
    expect(result.status).toBe(200)
    expect(await result.text()).toBe(wire)
    expect(m.fetch).toHaveBeenCalledOnce()
  })
  it.each(['context.read', 'context.compact'])(
    'refuses revoked %s scope before service contact',
    async (command) => {
      m.scope.mockRejectedValueOnce(new Error('Scope revoked'))
      await post({
        requestId,
        workspaceId: null,
        command,
        threadId: 'thread',
        ...(command === 'context.compact' ? { model: 'test/model', stream: false } : {}),
      })
      expect(m.fetch).not.toHaveBeenCalled()
    }
  )
  it.each(['runId', 'financial', 'usage', 'hasObservations'])(
    'rejects obsolete pruning/context field %s instead of inventing a charge',
    async (key) => {
      const context = key === 'hasObservations'
      m.fetch.mockResolvedValueOnce(
        Response.json({
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId,
          threadId: 'thread',
          ...(context
            ? { status: 'context', contextTokens: null, tokenSource: 'unavailable' }
            : { status: 'compacted', applied: false, sourceBoundaryVerified: true }),
          [key]: key === 'financial' ? completed().financial : true,
        })
      )
      const result = await post({
        requestId,
        workspaceId: null,
        command: context ? 'context.read' : 'context.compact',
        threadId: 'thread',
        ...(context ? {} : { model: 'test/model', stream: false }),
      })
      expect(result.status).toBe(503)
      const body = await result.json()
      expect(body).not.toHaveProperty('financial')
      expect(body).not.toHaveProperty('usage')
      expect(m.fetch).toHaveBeenCalledOnce()
    }
  )
  it('authors genuine nullable scope and strips upstream headers', async () => {
    const result = await post(list())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(response())
    expect(result.headers.get('x-private-sdk-header')).toBeNull()
    expect(m.scope).toHaveBeenCalledWith('actual-actor', null)
    expect(m.fetch).toHaveBeenCalledWith(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        scope,
        command: 'threads.list',
        page: { page: 0, perPage: 100 },
      },
      expect.any(AbortSignal)
    )
  })
  it.each(['scope', 'protocolRevision', 'toolManifest', 'headers', 'url', 'maxRetries'])(
    'refuses client supplied %s without service/model contact',
    async (key) => {
      expect((await post({ ...list(), [key]: 'forged' })).status).toBe(422)
      expect(m.fetch).not.toHaveBeenCalled()
    }
  )
  it('refuses unauthenticated calls', async () => {
    m.session.mockResolvedValueOnce(null)
    expect((await post(list())).status).toBe(401)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('rejects wrong revision/request and unknown private envelopes without projecting them', async () => {
    m.fetch.mockResolvedValueOnce(
      Response.json({ ...response(), requestId: 'stale', privateHeaders: { secret: 'hidden' } })
    )
    const result = await post(list())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('hidden')
  })
  it('builds original tool manifest and processed context only on explicit new message', async () => {
    m.fetch.mockResolvedValueOnce(Response.json(completed()))
    const result = await post({
      requestId,
      workspaceId: null,
      command: 'message',
      input: { content: 'Hello' },
      model: 'test/model',
      stream: false,
      accessLevel: 'full',
    })
    expect(result.status).toBe(200)
    expect(m.manifest).toHaveBeenCalledExactlyOnceWith('full')
    expect(m.fetch.mock.calls[0]![0]).toMatchObject({
      scope,
      toolManifest: { version: 'v1', tools: [] },
      input: { content: 'Hello', contexts: [] },
    })
    expect(m.images).not.toHaveBeenCalled()
  })
  it('refuses a schema-valid correlated response for the wrong actual command', async () => {
    m.fetch.mockResolvedValueOnce(Response.json(response()))
    const result = await post({
      requestId,
      workspaceId: null,
      command: 'message',
      input: { content: 'Hello' },
      model: 'test/model',
      stream: false,
    })
    expect(result.status).toBe(503)
    expect((await result.json()).error.code).toBe('UNCERTAIN')
    expect(m.fetch).toHaveBeenCalledOnce()
  })
  it('preserves only known accepted financial and usage facts when a response is the wrong kind', async () => {
    const financial = {
      accepted: true,
      modelUsd: 'unavailable',
      appliedUsd: '9007199254740993.30000000000000001',
    }
    const usage = { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
    m.fetch.mockResolvedValueOnce(
      Response.json({
        ...completed(),
        financial,
        usage,
        text: 'Wrong-kind private functional output',
      })
    )
    const result = await post(list())
    expect(result.status).toBe(503)
    const body = await result.json()
    expect(body).toMatchObject({
      requestId,
      status: 'failed',
      financial,
      usage,
      error: { code: 'UNCERTAIN', uncertain: true },
    })
    expect(body).not.toHaveProperty('text')
    expect(JSON.stringify(body)).not.toContain('Wrong-kind private')
    expect(m.fetch).toHaveBeenCalledOnce()
  })
  it('does not claim a foreign accepted fact after request correlation fails', async () => {
    m.fetch.mockResolvedValueOnce(Response.json({ ...completed(), requestId: 'foreign-request' }))
    const result = await post(list())
    expect(result.status).toBe(503)
    expect(await result.json()).not.toHaveProperty('financial')
    expect(m.fetch).toHaveBeenCalledOnce()
  })
  it.each(['threads.list', 'message'])(
    'refuses unsolicited SSE for actual nonstream %s request',
    async (command) => {
      m.fetch.mockResolvedValueOnce(
        new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      )
      const input =
        command === 'message'
          ? {
              requestId,
              workspaceId: null,
              command,
              input: { content: 'Hello' },
              model: 'test/model',
              stream: false,
            }
          : list()
      const result = await post(input)
      expect(result.status).toBe(503)
      expect(result.headers.get('content-type')).toContain('application/json')
      expect(m.fetch).toHaveBeenCalledOnce()
      expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
    }
  )
  it('refuses a cancellation-only terminal for a streamed message command', async () => {
    const event = {
      type: 'response.cancel_requested',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      result: {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'cancel_requested',
        runId: 'run',
        acknowledged: true,
        uncertaintyRemains: true,
      },
    }
    m.fetch.mockResolvedValueOnce(
      new Response(`data: ${JSON.stringify(event)}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )
    const result = await post({
      requestId,
      workspaceId: null,
      command: 'message',
      input: { content: 'Hello' },
      model: 'test/model',
      stream: true,
    })
    expect(result.status).toBe(200)
    expect(await copilotEvents(result)).toMatchObject([
      {
        type: 'response.error',
        result: { status: 'failed', error: { code: 'UNCERTAIN', uncertain: true } },
      },
    ])
    expect(m.fetch).toHaveBeenCalledOnce()
    expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
  })
  it.each([undefined, 0, '00', '0.10'])(
    'refuses invalid accepted money %j from a delegated success',
    async (appliedUsd) => {
      m.fetch.mockResolvedValueOnce(
        Response.json({
          ...completed(),
          financial: { accepted: true, modelUsd: 'unavailable', appliedUsd },
        })
      )
      const result = await post({
        requestId,
        workspaceId: null,
        command: 'message',
        input: { content: 'Hello' },
        model: 'test/model',
        stream: false,
      })
      expect(result.status).toBe(503)
      expect(m.fetch).toHaveBeenCalledOnce()
    }
  )
  it.each([
    [{ type: 'text', text: 'caller-authored native parts' }],
    [{ type: 'image', image: 'data:image/png;base64,AA==', mediaType: 'image/png' }],
  ])('rejects caller inline content parts before native contact: %j', async (content) => {
    expect(
      (
        await post({
          requestId,
          workspaceId: null,
          command: 'message',
          input: { content },
          model: 'test/model',
          stream: false,
        })
      ).status
    ).toBe(422)
    expect(m.contexts).not.toHaveBeenCalled()
    expect(m.images).not.toHaveBeenCalled()
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('native result/resume is pure, validates proof against genuine args and never rebuilds manifest or executes business effects', async () => {
    const p = pending()
    const body = {
      requestId,
      workspaceId: null,
      command: 'tool.result',
      source: 'studio_signed',
      target: p.target,
      financialBinding: p.financialBinding,
      result: { results: [], query: 'query' },
      proof: 'signed-proof',
      stream: false,
    }
    const results = await Promise.all([post(body), post(body)])
    expect(results.map((value) => value.status)).toEqual([200, 200])
    expect(m.proof).toHaveBeenCalledTimes(2)
    expect(m.proof).toHaveBeenCalledWith(
      'signed-proof',
      expect.objectContaining({
        originalArgs: p.originalArgs,
        binding: expect.objectContaining({
          actorId: 'actual-actor',
          workspaceId: null,
          toolCallId: 'call',
        }),
      })
    )
    expect(m.pending).toHaveBeenCalledTimes(2)
    expect(m.manifest).not.toHaveBeenCalled()
    expect(m.contexts).not.toHaveBeenCalled()
  })
  it.each([
    {
      parts: [
        { type: 'text', text: 'caption' },
        { type: 'file', mimeType: 'image/png', data: 'data:image/png;base64,AA==' },
      ],
    },
    {
      parts: [
        { type: 'text', text: 'caption' },
        { type: 'reasoning', text: 'native nontext' },
      ],
    },
    {
      parts: [
        { type: 'tool-invocation', toolInvocation: { state: 'result', result: { type: 'error' } } },
      ],
    },
  ])(
    'refuses retained nontext edit layout without edit/model delegation: %j',
    async ({ parts }) => {
      m.history.mockResolvedValueOnce([{ id: 'message', role: 'user', parts }])
      const result = await post({
        requestId,
        workspaceId: null,
        command: 'history.edit',
        threadId: 'thread',
        messageId: 'message',
        text: 'replacement',
      })
      expect(result.status).toBe(422)
      expect(await result.text()).toContain('Send a new message instead')
      expect(m.history).toHaveBeenCalledWith(scope, 'thread', expect.any(AbortSignal))
      expect(m.fetch).not.toHaveBeenCalled()
      expect(m.images).not.toHaveBeenCalled()
    }
  )
  it('requires an actual scoped message before pure text editing', async () => {
    m.history.mockResolvedValueOnce([])
    expect(
      (
        await post({
          requestId,
          workspaceId: null,
          command: 'history.edit',
          threadId: 'thread',
          messageId: 'missing',
          text: 'replacement',
        })
      ).status
    ).toBe(404)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('preserves ordinary scoped text editing without a media/source-proof lane', async () => {
    m.history.mockResolvedValueOnce([
      { id: 'message', role: 'user', parts: [{ type: 'text', text: 'old text' }] },
    ])
    m.fetch.mockResolvedValueOnce(
      Response.json({
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'updated',
        threadId: 'thread',
        operation: 'history.edit',
        messageId: 'message',
      })
    )
    const result = await post({
      requestId,
      workspaceId: null,
      command: 'history.edit',
      threadId: 'thread',
      messageId: 'message',
      text: 'replacement',
    })
    expect(result.status).toBe(200)
    expect(m.fetch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        command: 'history.edit',
        scope,
        threadId: 'thread',
        messageId: 'message',
        text: 'replacement',
      }),
      expect.any(AbortSignal)
    )
    expect(m.images).not.toHaveBeenCalled()
    expect(m.manifest).not.toHaveBeenCalled()
  })
  it('rejects stale binding, malformed result and revoked final entity rights before native resume', async () => {
    const p = pending()
    const body = {
      requestId,
      workspaceId: null,
      command: 'tool.result',
      source: 'studio_signed',
      target: p.target,
      financialBinding: { ...p.financialBinding, key: 'forged' },
      result: { results: [] },
      proof: 'signed',
      stream: false,
    }
    expect((await post(body)).status).toBe(403)
    expect(m.fetch).not.toHaveBeenCalled()
    body.financialBinding.key = p.financialBinding.key
    m.access.mockRejectedValueOnce(new Error('Revoked'))
    expect((await post(body)).status).toBe(422)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('never projects unexpected storage/financial errors as public native messages', async () => {
    m.scope.mockRejectedValueOnce(new Error('SQL private connection or receipt diagnostic'))
    const response = await post(list())
    expect(response.status).toBe(422)
    const body = await response.text()
    expect(body).not.toContain('SQL private')
    expect(body).toContain('could not be authorized or validated')
    expect(m.fetch).not.toHaveBeenCalled()
  })
})

const streamedInvocationCommands = [
  'message',
  'tool.approve',
  'tool.decline',
  'tool.result',
] as const
function streamedInvocation(command: (typeof streamedInvocationCommands)[number]) {
  if (command === 'message')
    return {
      requestId,
      workspaceId: null,
      command,
      input: { content: 'Hello' },
      model: 'test/model',
      stream: true,
    }
  const original = pending()
  if (command !== 'tool.result') original.stage = 'approval'
  m.pending.mockResolvedValueOnce(original)
  return {
    requestId,
    workspaceId: null,
    command,
    target: original.target,
    financialBinding: original.financialBinding,
    stream: true,
    ...(command === 'tool.result'
      ? {
          source: 'studio_signed',
          result: { results: [], query: 'query' },
          proof: 'signed-proof',
        }
      : {}),
  }
}
function compactEvent(applied: boolean): CopilotEvent {
  return {
    type: 'context.compacted',
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    result: {
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      status: 'compacted',
      threadId: 'thread',
      applied,
      sourceBoundaryVerified: true,
    },
  }
}

describe('actual facade command-specific streamed outcomes', () => {
  it.each(
    streamedInvocationCommands.flatMap((command) =>
      [true, false].map((applied) => ({ command, applied }))
    )
  )(
    'refuses compaction for an actual invocation without forwarding it: %j',
    async ({ command, applied }) => {
      const wrong = compactEvent(applied)
      m.fetch.mockResolvedValueOnce(eventResponse([wrong]))
      const response = await post(streamedInvocation(command))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(response.headers.get('x-private-sdk-header')).toBeNull()
      const events = await copilotEvents(response)
      expect(events).toHaveLength(1)
      expect(events).toMatchObject([
        {
          type: 'response.error',
          result: {
            status: 'failed',
            error: { code: 'UNCERTAIN', retryable: false, uncertain: true },
          },
        },
      ])
      expect(events[0]).not.toHaveProperty('result.applied')
      expect(events[0]).not.toHaveProperty('result.financial')
      expect(events[0]).not.toHaveProperty('result.usage')
      expect(m.fetch).toHaveBeenCalledOnce()
      expect(m.fetch.mock.calls[0]![0].command).toBe(command)
      expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
    }
  )
  it('retains validated accepted usage/money on wrong-kind compaction output without forwarding content', async () => {
    const financial = {
      accepted: true,
      modelUsd: 'unavailable',
      appliedUsd: '9007199254740993.30000000000000001',
    }
    const usage = { inputTokens: 0, outputTokens: 3, totalTokens: 7 }
    m.fetch.mockResolvedValueOnce(
      eventResponse([
        {
          type: 'response.completed',
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId,
          result: {
            ...completed(),
            financial,
            usage,
            text: 'Wrong-kind private functional output',
          },
        },
      ])
    )
    const response = await post({
      requestId,
      workspaceId: null,
      command: 'context.compact',
      threadId: 'thread',
      model: 'test/model',
      stream: true,
    })
    expect(response.status).toBe(200)
    const events = await copilotEvents(response)
    expect(events).toMatchObject([
      {
        type: 'response.error',
        result: { status: 'failed', financial, usage, error: { code: 'UNCERTAIN' } },
      },
    ])
    expect(events).toHaveLength(1)
    expect(events[0]).not.toHaveProperty('result.text')
    expect(events[0]).not.toHaveProperty('result.runId')
    expect(JSON.stringify(events)).not.toContain('Wrong-kind private')
    expect(m.fetch).toHaveBeenCalledOnce()
    expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
    expect(m.manifest).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'preserves valid unbilled streamed compaction applied=%s',
    async (applied) => {
      const event = compactEvent(applied)
      m.fetch.mockResolvedValueOnce(eventResponse([event]))
      const response = await post({
        requestId,
        workspaceId: null,
        command: 'context.compact',
        threadId: 'thread',
        model: 'test/model',
        stream: true,
      })
      expect(response.status).toBe(200)
      expect(await copilotEvents(response)).toEqual([event])
      expect(m.fetch).toHaveBeenCalledOnce()
      expect(m.fetch.mock.calls[0]![1].aborted).toBe(false)
      expect(m.manifest).not.toHaveBeenCalled()
    }
  )
  it.each(['outer', 'nested'] as const)(
    'refuses %s correlation before a wrong-kind accepted fact can be projected',
    async (location) => {
      const known = completed()
      const event = {
        type: 'response.completed',
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: location === 'outer' ? 'foreign' : requestId,
        result: location === 'nested' ? { ...known, requestId: 'foreign' } : known,
      }
      m.fetch.mockResolvedValueOnce(eventResponse([event]))
      const response = await post({
        requestId,
        workspaceId: null,
        command: 'context.compact',
        threadId: 'thread',
        model: 'test/model',
        stream: true,
      })
      expect(response.status).toBe(200)
      await expect(response.text()).rejects.toThrow('does not match')
      expect(m.fetch).toHaveBeenCalledOnce()
      expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
    }
  )
  it('rejects a wrong-kind terminal after a valid terminal without appending a second outcome', async () => {
    const valid = {
      type: 'response.completed',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      result: completed(),
    }
    m.fetch.mockResolvedValueOnce(eventResponse([valid, compactEvent(true)]))
    const response = await post(streamedInvocation('message'))
    if (!response.body) throw new Error('Expected streamed proxy body')
    const reader = response.body.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      `data: ${JSON.stringify(valid)}\n\n`
    )
    await expect(reader.read()).rejects.toThrow('after its terminal')
    reader.releaseLock()
    expect(m.fetch).toHaveBeenCalledOnce()
    expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
  })
  it('preserves the separate genuine collected cancel-command acknowledgement', async () => {
    const cancelled = {
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      status: 'cancel_requested',
      runId: 'run',
      acknowledged: true,
      uncertaintyRemains: true,
    }
    m.fetch.mockResolvedValueOnce(Response.json(cancelled))
    const response = await post({
      requestId,
      workspaceId: null,
      command: 'cancel',
      threadId: 'thread',
      runId: 'run',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(cancelled)
    expect(m.fetch).toHaveBeenCalledOnce()
    expect(m.manifest).not.toHaveBeenCalled()
  })
})

function invocationTerminal(kind: 'completed' | 'suspended' | 'refused' | 'failed'): CopilotEvent {
  if (kind === 'completed')
    return {
      type: 'response.completed',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      result: {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'completed',
        threadId: 'thread',
        runId: 'run',
        text: 'Hello',
        financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0' },
      },
    }
  if (kind === 'suspended') {
    const original = pending()
    original.stage = 'approval'
    return {
      type: 'response.suspended',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      result: {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'suspended',
        threadId: 'thread',
        runId: 'run',
        text: '',
        pending: [original],
        financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0' },
      },
    }
  }
  return {
    type: kind === 'refused' ? 'response.refused' : 'response.error',
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    result: {
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      status: kind,
      error: {
        code: 'NATIVE_FAILURE',
        message: 'Known native outcome',
        retryable: false,
        uncertain: false,
      },
    },
  }
}

it.each(
  streamedInvocationCommands.flatMap((command) =>
    (['completed', 'suspended', 'refused', 'failed'] as const).map((kind) => ({ command, kind }))
  )
)('preserves the authorized streamed invocation matrix: %j', async ({ command, kind }) => {
  const event = invocationTerminal(kind)
  m.fetch.mockResolvedValueOnce(eventResponse([event]))
  const response = await post(streamedInvocation(command))
  expect(response.status).toBe(200)
  expect(await copilotEvents(response)).toEqual([event])
  expect(m.fetch).toHaveBeenCalledOnce()
  expect(m.fetch.mock.calls[0]![0].command).toBe(command)
  expect(m.fetch.mock.calls[0]![1].aborted).toBe(false)
})

it('relays only the exact typed signed rejection to its result-stage native target', async () => {
  const item = {
    ...pending(),
    target: { ...pending().target, toolName: 'edit_workflow' },
    originalArgs: { entityId: 'workflow', entityDocument: 'original' },
  }
  m.pending.mockResolvedValue(item)
  const result = { success: false, rejected: true, toolName: 'edit_workflow' }
  const response = await post({
    command: 'tool.result',
    requestId,
    workspaceId: null,
    target: item.target,
    financialBinding: item.financialBinding,
    source: 'studio_signed',
    result,
    proof: 'signed-rejection',
    stream: false,
  })
  expect(response.status).toBe(200)
  expect(m.proof).toHaveBeenCalledWith(
    'signed-rejection',
    expect.objectContaining({ originalArgs: item.originalArgs, result })
  )
  expect(m.fetch).toHaveBeenCalledWith(
    expect.objectContaining({
      command: 'tool.result',
      source: 'studio_signed',
      target: item.target,
      result,
    }),
    expect.any(AbortSignal)
  )
  expect(m.manifest).not.toHaveBeenCalled()
})
it('never turns unsigned or malformed rejection into a browser assertion or turn cancel', async () => {
  const item = {
    ...pending(),
    target: { ...pending().target, toolName: 'edit_workflow' },
    originalArgs: { entityId: 'workflow', entityDocument: 'original' },
  }
  m.pending.mockResolvedValue(item)
  const response = await post({
    command: 'tool.result',
    requestId,
    workspaceId: null,
    target: item.target,
    financialBinding: item.financialBinding,
    source: 'studio_signed',
    result: { success: false, rejected: true, toolName: 'edit_workflow', requiresReview: true },
    proof: 'fake',
    stream: false,
  })
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(m.fetch).not.toHaveBeenCalled()
})

it('refuses an invalid rejection proof before native continuation with otherwise valid original input', async () => {
  const item = {
    ...pending(),
    target: { ...pending().target, toolName: 'edit_workflow' },
    originalArgs: { entityId: 'workflow', entityDocument: 'original' },
  }
  m.pending.mockResolvedValue(item)
  m.proof.mockRejectedValueOnce(new Error('Controlled signature verification refusal'))
  const result = { success: false, rejected: true, toolName: 'edit_workflow' }
  const response = await post({
    command: 'tool.result',
    requestId,
    workspaceId: null,
    target: item.target,
    financialBinding: item.financialBinding,
    source: 'studio_signed',
    result,
    proof: 'invalid-proof',
    stream: false,
  })
  expect(response.status).toBe(422)
  expect(m.proof).toHaveBeenCalledExactlyOnceWith(
    'invalid-proof',
    expect.objectContaining({ originalArgs: item.originalArgs, result })
  )
  expect(m.fetch).not.toHaveBeenCalled()
})

it.each(['tool.approve', 'tool.decline', 'tool.result'] as const)(
  'refuses cancellation-only output for the actual %s continuation',
  async (command) => {
    m.fetch.mockResolvedValueOnce(
      eventResponse([
        {
          type: 'response.cancel_requested',
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId,
          result: {
            protocolRevision: COPILOT_NATIVE_REVISION,
            requestId,
            status: 'cancel_requested',
            runId: 'run',
            acknowledged: true,
            uncertaintyRemains: true,
          },
        },
      ])
    )
    const response = await post(streamedInvocation(command))
    expect(response.status).toBe(200)
    expect(await copilotEvents(response)).toMatchObject([
      {
        type: 'response.error',
        result: { status: 'failed', error: { code: 'UNCERTAIN', uncertain: true } },
      },
    ])
    expect(m.fetch).toHaveBeenCalledOnce()
    expect(m.fetch.mock.calls[0]![1].aborted).toBe(true)
    expect(m.manifest).not.toHaveBeenCalled()
  }
)
