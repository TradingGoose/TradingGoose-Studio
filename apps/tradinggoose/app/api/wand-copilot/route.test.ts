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

    vi.doMock('@/lib/env', () => ({
      env: {
        COPILOT_API_URL: 'http://localhost:8000',
        COPILOT_API_KEY: 'test-copilot-key',
        INTERNAL_API_SECRET: 'test-internal-secret',
        WAND_OPENAI_MODEL_NAME: 'gpt-4.1-mini',
      },
    }))

    vi.doMock('@/lib/copilot/config', () => ({
      getCopilotModel: vi.fn(() => ({
        provider: 'anthropic',
        model: 'claude-4.5-sonnet',
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

    const payload = JSON.parse(init.body)
    expect(payload).toEqual({
      model: 'openai/gpt-4.1-mini',
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

  it('inherits the shared copilot provider/model when no wand override is configured', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        COPILOT_API_URL: 'http://localhost:8000',
        COPILOT_API_KEY: 'test-copilot-key',
        INTERNAL_API_SECRET: 'test-internal-secret',
        COPILOT_PROVIDER: 'azure-openai',
        COPILOT_MODEL: 'gpt-4.1',
      },
    }))

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
      model: 'azure-openai/gpt-4.1',
      stream: true,
    })
  })
})
