import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig, ProviderRequest } from '@/providers/ai/types'

const {
  mockCreate,
  mockExecuteTool,
  mockResolveAzureOpenAIServiceConfig,
  mockResolveOllamaServiceConfig,
  MockOpenAICompatibleClient,
} = vi.hoisted(() => {
  const create = vi.fn()
  class MockClient {
    chat = { completions: { create } }
  }

  return {
    mockCreate: create,
    mockExecuteTool: vi.fn(),
    mockResolveAzureOpenAIServiceConfig: vi.fn(),
    mockResolveOllamaServiceConfig: vi.fn(),
    MockOpenAICompatibleClient: MockClient,
  }
})

vi.mock('openai', () => {
  return { default: MockOpenAICompatibleClient, AzureOpenAI: MockOpenAICompatibleClient }
})

vi.mock('@cerebras/cerebras_cloud_sdk', () => ({ Cerebras: MockOpenAICompatibleClient }))
vi.mock('groq-sdk', () => ({ Groq: MockOpenAICompatibleClient }))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig: mockResolveAzureOpenAIServiceConfig,
  resolveOllamaServiceConfig: mockResolveOllamaServiceConfig,
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { azureOpenAIProvider } from '@/providers/ai/azure-openai'
import { cerebrasProvider } from '@/providers/ai/cerebras'
import { deepseekProvider } from '@/providers/ai/deepseek'
import { groqProvider } from '@/providers/ai/groq'
import { mistralProvider } from '@/providers/ai/mistral'
import { ollamaProvider } from '@/providers/ai/ollama'
import { openaiProvider } from '@/providers/ai/openai'
import { openRouterProvider } from '@/providers/ai/openrouter'
import { xAIProvider } from '@/providers/ai/xai'

const providers: Array<[string, ProviderConfig, Partial<ProviderRequest>]> = [
  ['OpenAI', openaiProvider, {}],
  ['Azure OpenAI', azureOpenAIProvider, { azureEndpoint: 'https://example.openai.azure.com' }],
  ['Cerebras', cerebrasProvider, {}],
  ['DeepSeek', deepseekProvider, {}],
  ['Groq', groqProvider, {}],
  ['Mistral', mistralProvider, {}],
  ['Ollama', ollamaProvider, {}],
  ['OpenRouter', openRouterProvider, {}],
  ['xAI', xAIProvider, {}],
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
    mockResolveOllamaServiceConfig.mockResolvedValue({ baseUrl: 'http://localhost:11434' })
    mockExecuteTool.mockResolvedValue({ success: true, output: 'tool result' })
  })

  it('forwards the signal to a direct streaming request', async () => {
    mockCreate.mockResolvedValueOnce(emptyStream())

    await provider.executeRequest({ ...baseRequest, stream: true })

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), { signal: abortSignal })
  })

  it('forwards the signal through initial, tool-loop, and final streaming requests', async () => {
    let nonStreamingCallCount = 0
    mockCreate.mockImplementation(async (payload: { stream?: boolean }) => {
      if (payload.stream) return emptyStream()
      nonStreamingCallCount++
      return nonStreamingCallCount === 1
        ? response({
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'test-tool', arguments: '{}' },
              },
            ],
          })
        : response({ content: 'done' })
    })

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

    expect(mockCreate).toHaveBeenCalledTimes(provider === cerebrasProvider ? 2 : 3)
    expect(mockCreate.mock.calls.every(([, options]) => options?.signal === abortSignal)).toBe(true)
  })

  it('keeps request options undefined when no signal is supplied', async () => {
    mockCreate.mockResolvedValueOnce(emptyStream())

    await provider.executeRequest({ ...baseRequest, abortSignal: undefined, stream: true })

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), undefined)
  })
})
