/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), native: vi.fn(), cancelled: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/copilot/native/completion', () => ({ createCompletionResponse: mocks.native }))

import { POST } from './route'

const result = () => ({
  status: 'completed',
  runId: 'native-run',
  text: 'Final result🔥',
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
  mocks.native.mockImplementation(async () =>
    stream([{ chunk: 'Preview🔥' }, { done: true, result: result() }], true)
  )
})
describe('built-in Wand completion route', () => {
  it('uses the actual session scope and returns the local completion stream', async () => {
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
      scope: { actorUserId: 'actual-actor', workspaceId: null },
      purpose: 'wand',
      model: 'anthropic/claude-fable-5',
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
    'preserves terminal %s completion state without inventing done',
    async (kind) => {
      const terminal =
        kind === 'error'
          ? {
              error: 'Delivery failed after acceptance',
              code: 'NATIVE_FAILURE',
              refusal: false,
            }
          : { cancelled: true }
      mocks.native.mockResolvedValueOnce(stream([{ chunk: 'Partial' }, terminal]))
      const text = await (await POST(request())).text()
      expect(text).toContain(JSON.stringify(terminal))
      expect(text).not.toContain('"done"')
    }
  )
  it('returns the local completion response with its status', async () => {
    const local = Response.json({ status: 'refused' }, { status: 402 })
    mocks.native.mockResolvedValueOnce(local)
    const response = await POST(request())
    expect(response).toBe(local)
    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({
      status: 'refused',
    })
  })
  it('passes the request signal directly and preserves local stream cancellation', async () => {
    const req = request()
    const local = new Response(new ReadableStream({ pull() {}, cancel: mocks.cancelled }))
    mocks.native.mockResolvedValueOnce(local)
    const response = await POST(req)
    expect(response).toBe(local)
    expect(mocks.native.mock.calls[0][1]).toBe(req.signal)
    await response.body!.cancel('reader closed')
    expect(mocks.cancelled).toHaveBeenCalledExactlyOnceWith('reader closed')
  })
  it('forwards caller cancellation to the local completion without a separate abort relay', async () => {
    const abort = new AbortController()
    const req = new NextRequest('http://localhost/api/wand-copilot', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Refine' }),
      signal: abort.signal,
    })
    const response = await POST(req)
    expect(mocks.native.mock.calls[0][1]).toBe(req.signal)
    abort.abort()
    expect(mocks.native.mock.calls[0][1].aborted).toBe(true)
    await response.body!.cancel()
  })
  it('reports a local completion failure without exposing its diagnostics', async () => {
    mocks.native.mockRejectedValueOnce(new Error('private-runtime-detail'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Wand generation is unavailable' })
    expect(mocks.native).toHaveBeenCalledOnce()
  })
})
