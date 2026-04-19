/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Wand Copilot API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockAuth().setAuthenticated()

    vi.doMock('@/lib/system-services/runtime', () => ({
      resolveCopilotApiServiceConfig: vi.fn(async () => ({
        baseUrl: 'http://localhost:8000',
        apiKey: 'test-copilot-key',
      })),
    }))

    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('routes wand requests through raw completion and rewrites the SSE payload', async () => {
    const upstreamStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"First chunk"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":" second chunk"}}]}\n\n' +
              'data: [DONE]\n\n'
          )
        )
        controller.close()
      },
    })

    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      body: upstreamStream,
    })

    const req = createMockRequest('POST', {
      prompt: 'Refine this function',
      systemPrompt: 'You are a code assistant.',
      history: [{ role: 'assistant', content: 'Prior answer' }],
    })

    const { POST } = await import('@/app/api/wand-copilot/route')
    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/completion?version=v1')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'test-copilot-key',
      'x-copilot-user-id': 'user-123',
    })

    const payload = JSON.parse(init.body)
    expect(payload).toEqual({
      model: 'anthropic/claude-sonnet-4.6',
      stream: true,
      messages: [
        { role: 'system', content: 'You are a code assistant.' },
        { role: 'assistant', content: 'Prior answer' },
        { role: 'user', content: 'Refine this function' },
      ],
    })

    const text = await response.text()
    expect(text).toContain('data: {"chunk":"First chunk"}')
    expect(text).toContain('data: {"chunk":" second chunk"}')
    expect(text).toContain('data: {"done":true}')
  })

  it('uses the default copilot provider and model without env overrides', async () => {
    const upstreamStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })

    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      body: upstreamStream,
    })

    const req = createMockRequest('POST', {
      prompt: 'Refine this function',
    })

    const { POST } = await import('@/app/api/wand-copilot/route')
    const response = await POST(req)

    expect(response.status).toBe(200)

    const [, init] = (global.fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload).toMatchObject({
      model: 'anthropic/claude-sonnet-4.6',
      stream: true,
    })
  })

  it('appends strict json-object output constraints when generationType is provided', async () => {
    const upstreamStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })

    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      body: upstreamStream,
    })

    const req = createMockRequest('POST', {
      prompt: 'Generate a filter object',
      systemPrompt: 'Generate a Mongo-style filter object.',
      generationType: 'json-object',
    })

    const { POST } = await import('@/app/api/wand-copilot/route')
    const response = await POST(req)

    expect(response.status).toBe(200)

    const [, init] = (global.fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.messages[0]).toMatchObject({
      role: 'system',
    })
    expect(payload.messages[0].content).toContain('STRICT OUTPUT CONTRACT:')
    expect(payload.messages[0].content).toContain('Return ONLY a single valid JSON object.')
    expect(payload.messages[0].content).toContain('The response must start with { and end with }.')
  })
})
