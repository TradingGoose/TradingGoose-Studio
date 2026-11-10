/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COPILOT_NATIVE_REVISION, type CompletionRequest } from '@/lib/copilot/native/contract'

const mocks = vi.hoisted(() => ({ session: vi.fn(), native: vi.fn(), cancelled: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/copilot/native/client', () => ({ fetchNativeCompletion: mocks.native }))

import { POST } from './route'

const financial = { accepted: true, modelUsd: 'unavailable', appliedUsd: '0' }
const result = (id: string) => ({
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId: id,
  status: 'completed',
  runId: 'native-run',
  text: 'Final result🔥',
  financial,
})
const request = (body: unknown = { prompt: 'Refine this function' }) =>
  new NextRequest('http://localhost/api/wand-copilot', {
    method: 'POST',
    body: JSON.stringify(body),
  })
function stream(frames: unknown[], split = false) {
  const bytes = new TextEncoder().encode(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('')
  )
  return new Response(
    new ReadableStream({
      start(controller) {
        if (split) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        else controller.enqueue(bytes)
        controller.close()
      },
      cancel: mocks.cancelled,
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'actual-actor' } })
  mocks.native.mockImplementation(async (input: CompletionRequest) =>
    stream([{ chunk: 'Preview🔥' }, { done: true, result: result(input.requestId) }], true)
  )
})
describe('native wand utility transport', () => {
  it('constructs actual session personal scope and relays closed native events through split UTF8/SSE', async () => {
    const response = await POST(
      request({
        prompt: 'Refine',
        systemPrompt: 'Only code',
        history: [{ role: 'assistant', content: 'Earlier' }],
      })
    )
    expect(response.status).toBe(200)
    const [input, signal] = mocks.native.mock.calls[0]
    expect(input).toEqual({
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId: expect.any(String),
      scope: { actorUserId: 'actual-actor', workspaceId: null },
      purpose: 'wand',
      model: 'anthropic/claude-fable-5',
      stream: true,
      messages: [
        { role: 'system', content: 'Only code' },
        { role: 'assistant', content: 'Earlier' },
        { role: 'user', content: 'Refine' },
      ],
    })
    expect(signal).toBeInstanceOf(AbortSignal)
    const text = await response.text()
    expect(text).toContain('"chunk":"Preview🔥"')
    expect(text).toContain('"done":true,"result":')
    expect(text).toContain('"text":"Final result🔥"')
    expect(text).not.toMatch(/choices|delta|\[DONE\]/)
    expect(response.headers.get('x-wand-request-id')).toBe(input.requestId)
  })
  it('preserves generation type output contracts', async () => {
    const response = await POST(
      request({ prompt: 'Filter', generationType: 'json-object', systemPrompt: 'Mongo filter' })
    )
    await response.text()
    const [input] = mocks.native.mock.calls[0]
    expect(input.messages[0].content).toContain('STRICT OUTPUT CONTRACT:')
    expect(input.messages[0].content).toContain('Return ONLY a single valid JSON object.')
  })
  it.each([null, {}])('refuses unauthenticated actor (%j)', async (session) => {
    mocks.session.mockResolvedValueOnce(session)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.native).not.toHaveBeenCalled()
  })
  it.each([
    'scope',
    'actorUserId',
    'workspaceId',
    'runId',
    'model',
    'headers',
    'version',
    'streaming',
  ])('rejects caller-owned %s controls', async (field) => {
    expect((await POST(request({ prompt: 'x', [field]: 'forged' }))).status).toBe(400)
    expect(mocks.native).not.toHaveBeenCalled()
  })
  it.each(['error', 'cancelled'] as const)(
    'preserves terminal %s financial acceptance without inventing done',
    async (kind) => {
      const terminal =
        kind === 'error'
          ? {
              error: 'Delivery failed after acceptance',
              code: 'NATIVE_FAILURE',
              refusal: false,
              uncertain: false,
              financialDisposition: 'accepted',
              financial,
            }
          : { cancelled: true, uncertain: false, financialDisposition: 'accepted', financial }
      mocks.native.mockResolvedValueOnce(stream([{ chunk: 'Partial' }, terminal]))
      const text = await (await POST(request())).text()
      expect(text).toContain(JSON.stringify(terminal))
      expect(text).not.toContain('"done"')
    }
  )
  it('preserves correlated collected refusal/financial disposition and never forwards raw errors', async () => {
    mocks.native.mockImplementationOnce(async (input: CompletionRequest) =>
      Response.json(
        {
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId: input.requestId,
          status: 'refused',
          error: { code: 'QUOTA_EXCEEDED', message: 'Quota', retryable: false, uncertain: false },
          uncertain: false,
          financialDisposition: 'not_contacted',
        },
        { status: 402 }
      )
    )
    const response = await POST(request())
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      status: 'refused',
      financialDisposition: 'not_contacted',
    })
    mocks.native.mockResolvedValueOnce(
      Response.json({ request: 'private-sdk-envelope' }, { status: 500 })
    )
    const refused = await POST(request())
    expect(refused.status).toBe(502)
    expect(await refused.text()).not.toContain('private-sdk-envelope')
  })
  it.each(['eof', 'bare-done', 'wrong-request', 'raw-sdk'])(
    'refuses %s without a happy terminal',
    async (kind) => {
      mocks.native.mockImplementationOnce(async () =>
        stream(
          kind === 'eof'
            ? [{ chunk: 'partial' }]
            : kind === 'bare-done'
              ? [{ done: true }]
              : kind === 'wrong-request'
                ? [{ done: true, result: result('another-request') }]
                : [{ choices: [{ delta: { content: 'raw' } }] }]
        )
      )
      const response = await POST(request())
      await expect(response.text()).rejects.toThrow()
    }
  )
  it('cancels the upstream reader and actual native signal when the downstream reader cancels', async () => {
    mocks.native.mockResolvedValueOnce(
      new Response(new ReadableStream({ pull() {}, cancel: mocks.cancelled }))
    )
    const response = await POST(request())
    await response.body!.cancel('reader closed')
    expect(mocks.native.mock.calls[0][1].aborted).toBe(true)
    expect(mocks.cancelled).toHaveBeenCalledOnce()
  })
})
