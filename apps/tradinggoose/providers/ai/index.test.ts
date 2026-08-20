import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOpenAIExecuteRequest } = vi.hoisted(() => ({
  mockOpenAIExecuteRequest: vi.fn(),
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
    executeRequest: vi.fn(),
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
    executeRequest: vi.fn(),
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
    executeRequest: vi.fn(),
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

describe('executeProviderRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      systemPrompt: '',
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
})
