/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('requestCopilotTitle', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/env', () => ({
      env: {
        COPILOT_API_URL: 'http://localhost:8000',
        COPILOT_API_KEY: 'test-copilot-key',
        INTERNAL_API_SECRET: 'test-internal-secret',
      },
    }))

    vi.doMock('@/lib/copilot/config', () => ({
      getCopilotModel: vi.fn(() => ({
        provider: 'anthropic',
        model: 'claude-sonnet-4.6',
      })),
    }))

    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('uses the provided provider/model when generating a title', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: 'Momentum Screener',
              },
            },
          ],
        }),
    })

    const { requestCopilotTitle } = await import('@/lib/copilot/agent/utils')

    const title = await requestCopilotTitle({
      message: 'Build a momentum screener with RSI filters',
      model: 'gpt-5.4',
      provider: 'openai',
    })

    expect(title).toBe('Momentum Screener')
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/completion?version=v1')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'test-copilot-key',
    })

    const payload = JSON.parse(init.body)
    expect(payload).toMatchObject({
      model: 'openai/gpt-5.4',
      stream: false,
    })
    expect(payload.messages).toEqual([
      {
        role: 'system',
        content: 'Generate a concise, descriptive chat title based on the user message.',
      },
      {
        role: 'user',
        content: 'Create a short title for this: Build a momentum screener with RSI filters',
      },
    ])
  })

  it('derives the provider from the runtime model when provider is omitted', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: 'Skill Review',
              },
            },
          ],
        }),
    })

    const { requestCopilotTitle } = await import('@/lib/copilot/agent/utils')

    const title = await requestCopilotTitle({
      message: 'Review the current skill implementation',
      model: 'claude-opus-4.6',
    })

    expect(title).toBe('Skill Review')

    const [, init] = (global.fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.model).toBe('anthropic/claude-opus-4.6')
  })
})
