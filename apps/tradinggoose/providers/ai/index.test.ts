import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockOpenAIExecuteRequest,
  mockOllamaExecuteRequest,
  mockAnthropicExecuteRequest,
  mockDeepseekExecuteRequest,
  environment,
} = vi.hoisted(() => ({
  mockOpenAIExecuteRequest: vi.fn(),
  mockOllamaExecuteRequest: vi.fn(),
  mockAnthropicExecuteRequest: vi.fn(),
  mockDeepseekExecuteRequest: vi.fn(),
  environment: { isHosted: false },
}))

vi.mock('@/lib/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/environment')>()),
  get isHosted() {
    return environment.isHosted
  },
}))

vi.mock('@/providers/ai/openai', () => ({
  openaiProvider: {
    id: 'openai',
    name: 'OpenAI',
    description: 'test',
    version: 'test',
    models: ['gpt-4.1'],
    defaultModel: 'gpt-4.1',
    executeRequest: mockOpenAIExecuteRequest,
  },
}))

vi.mock('@/providers/ai/anthropic', () => ({
  anthropicProvider: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: mockAnthropicExecuteRequest,
  },
}))

vi.mock('@/providers/ai/azure-openai', () => ({
  azureOpenAIProvider: {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/cerebras', () => ({
  cerebrasProvider: {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/deepseek', () => ({
  deepseekProvider: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: mockDeepseekExecuteRequest,
  },
}))

vi.mock('@/providers/ai/google', () => ({
  googleProvider: {
    id: 'google',
    name: 'Google',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/groq', () => ({
  groqProvider: {
    id: 'groq',
    name: 'Groq',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/mistral', () => ({
  mistralProvider: {
    id: 'mistral',
    name: 'Mistral',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/ollama', () => ({
  ollamaProvider: {
    id: 'ollama',
    name: 'Ollama',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: mockOllamaExecuteRequest,
  },
}))

vi.mock('@/providers/ai/openrouter', () => ({
  openRouterProvider: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/xai', () => ({
  xAIProvider: {
    id: 'xai',
    name: 'xAI',
    description: 'test',
    version: 'test',
    models: [],
    defaultModel: '',
    executeRequest: vi.fn(),
  },
}))

import { executeProviderRequest } from '@/providers/ai'
import type { ProviderRequest } from '@/providers/ai/types'

describe('executeProviderRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    environment.isHosted = false
    mockOpenAIExecuteRequest.mockResolvedValue({ content: 'ok', model: 'gpt-5.4' })
    mockAnthropicExecuteRequest.mockResolvedValue({ content: 'ok', model: 'claude-sonnet-4-6' })
    mockDeepseekExecuteRequest.mockResolvedValue({ content: 'ok', model: 'deepseek-v4-flash' })
  })

  it('rejects an empty request before calling the provider', async () => {
    await expect(
      executeProviderRequest('openai', { model: 'gpt-5.4', context: ' ' })
    ).rejects.toThrow('require messages, context, or a system prompt')
    expect(mockOpenAIExecuteRequest).not.toHaveBeenCalled()
  })

  it.each([
    [
      'openai',
      { model: 'gpt-5.4', reasoningEffort: 'xhigh', verbosity: 'high', thinkingLevel: 'high' },
      { reasoningEffort: 'xhigh', verbosity: 'high', thinkingLevel: undefined },
    ],
    ['anthropic', { model: 'claude-sonnet-4-6', thinkingLevel: 'max' }, { thinkingLevel: 'max' }],
    [
      'deepseek',
      { model: 'deepseek-v4-flash', reasoningEffort: 'max', thinkingLevel: 'none' },
      { reasoningEffort: 'max', thinkingLevel: 'none' },
    ],
    [
      'openai',
      { model: 'gpt-4.1', reasoningEffort: 'high', verbosity: 'high', thinkingLevel: 'high' },
      { reasoningEffort: undefined, verbosity: undefined, thinkingLevel: undefined },
    ],
    [
      'anthropic',
      { model: 'claude-sonnet-4-6', thinkingLevel: 'xhigh' },
      { thinkingLevel: undefined },
    ],
  ] as const)('filters settings by model for %s: %j', async (provider, settings, expected) => {
    const request = { ...settings, context: 'Test prompt' }
    const original = { ...request }
    await executeProviderRequest(provider, request)
    const executeRequest = {
      openai: mockOpenAIExecuteRequest,
      anthropic: mockAnthropicExecuteRequest,
      deepseek: mockDeepseekExecuteRequest,
    }[provider]
    expect(executeRequest).toHaveBeenCalledWith(expect.objectContaining(expected))
    expect(request).toEqual(original)
  })

  it.each([undefined, '', ' ', 'auto', 'invalid'])(
    'omits the optional setting %j',
    async (value) => {
      await executeProviderRequest('openai', {
        model: 'gpt-5.4',
        context: 'Test prompt',
        reasoningEffort: value,
        verbosity: value,
        thinkingLevel: value,
      })

      expect(mockOpenAIExecuteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoningEffort: undefined,
          verbosity: undefined,
          thinkingLevel: undefined,
        })
      )
    }
  )

  it('converts numeric input strings before calling the provider', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-4.1',
      context: 'Test prompt',
      maxTokens: '1024',
      temperature: '0',
    } as unknown as ProviderRequest)

    expect(mockOpenAIExecuteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 1024, temperature: 0 })
    )
  })

  it.each([undefined, null, '', ' ', 'invalid', Number.NaN, Number.POSITIVE_INFINITY])(
    'omits invalid numeric inputs %j',
    async (value) => {
      await executeProviderRequest('openai', {
        model: 'gpt-4.1',
        context: 'Test prompt',
        maxTokens: value,
        temperature: value,
      } as unknown as ProviderRequest)

      expect(mockOpenAIExecuteRequest).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: undefined, temperature: undefined })
      )
    }
  )

  it.each([
    ['gpt-4.1', 'maxTokens', 0],
    ['gpt-4.1', 'maxTokens', -1],
    ['gpt-4.1', 'maxTokens', 1.5],
    ['gpt-4.1', 'temperature', -0.1],
    ['gpt-4.1', 'temperature', 2.1],
    ['gpt-5.4', 'temperature', 0.5],
  ] as const)('omits unsupported numeric settings: %s %s %j', async (model, field, value) => {
    await executeProviderRequest('openai', { model, [field]: value, context: 'Test prompt' })
    expect(mockOpenAIExecuteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ [field]: undefined })
    )
  })

  it('calculates model usage cost for token-bearing responses', async () => {
    mockOpenAIExecuteRequest.mockResolvedValue({
      content: 'ok',
      model: 'gpt-4.1',
      tokens: {
        prompt: 1200,
        completion: 300,
        total: 1500,
      },
    })

    const response = await executeProviderRequest('openai', {
      model: 'gpt-4.1',
      systemPrompt: 'Test prompt',
      apiKey: 'test-key',
    })

    expect(response).not.toBeInstanceOf(ReadableStream)
    expect('stream' in (response as object)).toBe(false)

    expect(response).toMatchObject({
      cost: {
        input: 0.0024,
        output: 0.0024,
        total: 0.0048,
        pricing: {
          input: 2,
          output: 8,
        },
      },
    })
  })

  it('rejects hosted Ollama execution before calling the provider', async () => {
    environment.isHosted = true

    await expect(
      executeProviderRequest('ollama', {
        model: 'ollama/llama3.2',
      })
    ).rejects.toThrow('Ollama is not available on hosted instances')

    expect(mockOllamaExecuteRequest).not.toHaveBeenCalled()
  })
})
