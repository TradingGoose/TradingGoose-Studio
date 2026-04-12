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
    models: ['gpt-4o'],
    defaultModel: 'gpt-4o',
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
import { calculateCost } from '@/providers/ai/utils'

describe('executeProviderRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns raw model cost without any hidden environment multiplier', async () => {
    mockOpenAIExecuteRequest.mockResolvedValue({
      content: 'ok',
      model: 'gpt-4o',
      tokens: {
        prompt: 1200,
        completion: 300,
        total: 1500,
      },
    })

    const response = await executeProviderRequest('openai', {
      model: 'gpt-4o',
      systemPrompt: '',
      apiKey: 'test-key',
    })

    expect(response).not.toBeInstanceOf(ReadableStream)
    expect('stream' in (response as object)).toBe(false)

    const expectedCost = calculateCost('gpt-4o', 1200, 300, false)
    expect(response).toMatchObject({
      cost: expectedCost,
    })
  })
})
