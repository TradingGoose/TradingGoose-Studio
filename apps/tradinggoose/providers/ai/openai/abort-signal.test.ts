import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig, ProviderRequest } from '@/providers/ai/types'

const { mockCreate, mockExecuteTool, mockResolveAzureOpenAIServiceConfig } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockResolveAzureOpenAIServiceConfig: vi.fn(),
}))

vi.mock('openai', () => {
  class MockOpenAIClient {
    chat = { completions: { create: mockCreate } }
  }

  return { default: MockOpenAIClient, AzureOpenAI: MockOpenAIClient }
})

vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig: mockResolveAzureOpenAIServiceConfig,
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { azureOpenAIProvider } from '@/providers/ai/azure-openai'
import { openaiProvider } from '@/providers/ai/openai'

const providers: Array<[string, ProviderConfig, Partial<ProviderRequest>]> = [
  ['OpenAI', openaiProvider, {}],
  ['Azure OpenAI', azureOpenAIProvider, { azureEndpoint: 'https://example.openai.azure.com' }],
]

const emptyStream = () => ({
  async *[Symbol.asyncIterator]() {},
})

const response = (message: Record<string, unknown>) => ({
  choices: [{ message }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
})

describe.each(providers)('%s abort signal forwarding', (_name, provider, providerRequest) => {
  const abortSignal = new AbortController().signal
  const baseRequest: ProviderRequest = {
    model: 'gpt-4o',
    apiKey: 'test-key',
    abortSignal,
    ...providerRequest,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAzureOpenAIServiceConfig.mockResolvedValue({})
    mockExecuteTool.mockResolvedValue({ success: true, output: 'tool result' })
  })

  it('forwards the signal to a direct streaming request', async () => {
    mockCreate.mockResolvedValueOnce(emptyStream())

    await provider.executeRequest({ ...baseRequest, stream: true })

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), { signal: abortSignal })
  })

  it('forwards the signal through initial, tool-loop, and final streaming requests', async () => {
    mockCreate
      .mockResolvedValueOnce(
        response({
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'test-tool', arguments: '{}' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(response({ content: 'done' }))
      .mockResolvedValueOnce(emptyStream())

    await provider.executeRequest({
      ...baseRequest,
      stream: true,
      tools: [
        {
          id: 'test-tool',
          name: 'Test tool',
          description: 'Test tool',
          params: {},
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
    })

    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(mockCreate.mock.calls.every(([, options]) => options?.signal === abortSignal)).toBe(true)
  })
})
