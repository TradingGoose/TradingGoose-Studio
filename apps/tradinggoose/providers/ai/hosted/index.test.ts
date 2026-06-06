import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProxyCopilotCompletionRequest } = vi.hoisted(() => ({
  mockProxyCopilotCompletionRequest: vi.fn(),
}))

vi.mock('@/app/api/copilot/proxy', () => ({
  proxyCopilotCompletionRequest: mockProxyCopilotCompletionRequest,
}))

import { hostedProvider } from '@/providers/ai/hosted'
import type { ProviderResponse } from '@/providers/ai/types'

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('hostedProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes hosted models through the Copilot completion endpoint', async () => {
    mockProxyCopilotCompletionRequest.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      })
    )

    const response = (await hostedProvider.executeRequest({
      model: 'hosted/openai/gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
    })) as ProviderResponse

    expect(response).toMatchObject({
      content: 'ok',
      model: 'hosted/openai/gpt-5.4',
      tokens: { prompt: 10, completion: 3, total: 13 },
    })

    expect(mockProxyCopilotCompletionRequest).toHaveBeenCalledTimes(1)
    expect(mockProxyCopilotCompletionRequest).toHaveBeenCalledWith({
      body: {
        model: 'openai/gpt-5.4',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      },
      signal: undefined,
      headers: undefined,
    })
  })

  it('rejects hosted models without an explicit provider namespace', async () => {
    await expect(
      hostedProvider.executeRequest({
        model: 'hosted/gpt-5.4',
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow('Unsupported hosted model: hosted/gpt-5.4')

    expect(mockProxyCopilotCompletionRequest).not.toHaveBeenCalled()
  })
})
