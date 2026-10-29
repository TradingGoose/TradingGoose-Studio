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
    executeRequest: mockOpenAIExecuteRequest,
  },
}))

vi.mock('@/providers/ai/anthropic', () => ({
  anthropicProvider: {
    executeRequest: mockAnthropicExecuteRequest,
  },
}))

vi.mock('@/providers/ai/azure-openai', () => ({
  azureOpenAIProvider: {
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/cerebras', () => ({
  cerebrasProvider: {
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/deepseek', () => ({
  deepseekProvider: {
    executeRequest: mockDeepseekExecuteRequest,
  },
}))

vi.mock('@/providers/ai/google', () => ({
  googleProvider: {
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/groq', () => ({
  groqProvider: {
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/mistral', () => ({
  mistralProvider: {
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/ollama', () => ({
  ollamaProvider: {
    executeRequest: mockOllamaExecuteRequest,
  },
}))

vi.mock('@/providers/ai/openrouter', () => ({
  openRouterProvider: {
    executeRequest: vi.fn(),
  },
}))

vi.mock('@/providers/ai/xai', () => ({
  xAIProvider: {
    executeRequest: vi.fn(),
  },
}))

import { executeProviderRequest } from '@/providers/ai'
import type { ProviderRequest } from '@/providers/ai/types'

describe('executeProviderRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    environment.isHosted = false
    const cost = { input: 0, output: 0, total: 0, pricing: null }
    mockOpenAIExecuteRequest.mockResolvedValue({ content: 'ok', model: 'gpt-5.4', cost })
    mockAnthropicExecuteRequest.mockResolvedValue({
      content: 'ok',
      model: 'claude-sonnet-5-5',
      cost,
    })
    mockDeepseekExecuteRequest.mockResolvedValue({ content: 'ok', model: 'deepseek-flash', cost })
  })

  it.each([
    { context: ' ' },
    { systemPrompt: ' ' },
    { messages: [{ role: 'system' as const, content: ' ' }] },
  ])('rejects an empty request before calling the provider: %j', async (input) => {
    await expect(executeProviderRequest('openai', { model: 'gpt-5.4', ...input })).rejects.toThrow(
      'require messages, context, or a system prompt'
    )
    expect(mockOpenAIExecuteRequest).not.toHaveBeenCalled()
  })

  it.each([
    [{ systemPrompt: 'Analyze prices' }, 'Analyze prices'],
    [{ messages: [{ role: 'system', content: 'Analyze prices' }] }, 'Analyze prices'],
    [
      {
        systemPrompt: 'Analyze prices',
        context: ' ',
        messages: [
          { role: 'system', content: 'Use live quotes' },
          { role: 'system', content: 'Include risks' },
        ],
      },
      'Analyze prices\n\nUse live quotes\n\nInclude risks',
    ],
  ] as const)('normalizes system-only instructions once: %j', async (input, content) => {
    const request = { model: 'claude-sonnet-5-5', ...structuredClone(input) } as ProviderRequest
    const original = structuredClone(request)

    await executeProviderRequest('anthropic', request)

    expect(mockAnthropicExecuteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: '', messages: [{ role: 'user', content }] })
    )
    expect(request).toEqual(original)
  })

  it.each([{ context: 'AAPL' }, { messages: [{ role: 'user' as const, content: 'AAPL' }] }])(
    'preserves system instructions with conversational input: %j',
    async (input) => {
      const request = { model: 'claude-sonnet-5-5', systemPrompt: 'Analyze prices', ...input }
      const original = structuredClone(request)

      await executeProviderRequest('anthropic', request)

      expect(mockAnthropicExecuteRequest).toHaveBeenCalledWith(expect.objectContaining(request))
      expect(request).toEqual(original)
    }
  )

  it.each([
    [
      'openai',
      { model: 'gpt-5.4', reasoningEffort: 'xhigh', verbosity: 'high', thinkingLevel: 'high' },
      { reasoningEffort: 'xhigh', verbosity: 'high', thinkingLevel: undefined },
    ],
    ['anthropic', { model: 'claude-sonnet-5-5', thinkingLevel: 'max' }, { thinkingLevel: 'max' }],
    [
      'deepseek',
      { model: 'deepseek-flash', reasoningEffort: 'max', thinkingLevel: 'none' },
      { reasoningEffort: 'max', thinkingLevel: 'none' },
    ],
    [
      'openai',
      { model: 'gpt-4.1', reasoningEffort: 'high', verbosity: 'high', thinkingLevel: 'high' },
      { reasoningEffort: undefined, verbosity: undefined, thinkingLevel: undefined },
    ],
    [
      'anthropic',
      { model: 'claude-haiku-4-5', thinkingLevel: 'xhigh' },
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
    expect(executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: settings.model, ...expected })
    )
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

  it.each([
    ['openai', 'gpt-4.1', '16', 16, mockOpenAIExecuteRequest],
    ['anthropic', 'claude-haiku-4-5', 1, 1, mockAnthropicExecuteRequest],
  ] as const)(
    'converts numeric controls within %s %s limits',
    async (provider, model, value, expected, execute) => {
      await executeProviderRequest(provider, {
        model,
        context: 'Test prompt',
        maxTokens: value,
        temperature: '0',
      } as unknown as ProviderRequest)

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: expected, temperature: 0 })
      )
    }
  )

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
    ['gpt-4.1', 'maxTokens', 1],
    ['gpt-4.1', 'maxTokens', 15],
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

  it('preserves per-call tier costs when aggregate usage crosses a threshold', async () => {
    mockAnthropicExecuteRequest.mockResolvedValue({
      content: 'ok',
      model: 'claude-haiku-5-5',
      tokens: { input: 120000, output: 2000 },
      cost: { input: 0.012, output: 0.001, total: 0.013, pricing: null },
    })

    const response = await executeProviderRequest('anthropic', {
      model: 'claude-haiku-5-5',
      context: 'Analyze',
    })
    if ('stream' in response) throw new Error('Expected non-streaming result')
    expect(response.cost).toMatchObject({ input: 0.012, output: 0.001 })
    expect(response.cost?.total).toBeCloseTo(0.013, 8)
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

  it('normalizes Claude usage and recomputes inclusive tool costs once', async () => {
    mockAnthropicExecuteRequest.mockResolvedValue({
      content: 'ok',
      model: 'claude-sonnet-5-5',
      tokens: { input: 100, output: 20 },
      toolResults: [{ cost: { total: 1.25 } }, { cost: { total: 0.75 } }],
      cost: { input: 0.0002, output: 0.0002, toolCost: 2, total: 2.0004, pricing: null },
    })
    const response = await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5-5',
      messages: [{ role: 'user', content: 'Test prompt' }],
    })
    if ('stream' in response) throw new Error('Expected non-streaming result')
    expect(response.tokens).toEqual({ prompt: 100, completion: 20, total: 120 })
    expect(response.cost?.input).toBeCloseTo(0.0002)
    expect(response.cost?.output).toBeCloseTo(0.0002)
    expect(response.cost?.toolCost).toBe(2)
    expect(response.cost?.total).toBeCloseTo(2.0004)
  })
})
