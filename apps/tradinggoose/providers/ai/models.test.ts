import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/providers/ai/openrouter/models/route'
import { executeProviderRequest } from '@/providers/ai'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getAllModelProviders,
  getBaseModelProviders,
  getMaxOutputTokensForModel,
  getMaxTemperature,
  getModelCapabilities,
  getModelPricing,
  getProviderDefaultModel,
  getProviderFromModel,
  getProviderIcon,
  getProviderModels,
  getReasoningEffortValuesForModel,
  getThinkingCapability,
  getVerbosityValuesForModel,
  PROVIDER_DEFINITIONS,
  updateFireworksModels,
  updateOllamaModels,
  updateOpenRouterModels,
  updateVLLMModels,
} from '@/providers/ai/models'
import { getOpenRouterModels } from '@/providers/ai/openrouter/models'
import { calculateCost } from '@/providers/ai/utils'
import { useProvidersStore } from '@/stores/providers/store'

const mocks = vi.hoisted(() => ({ chat: vi.fn(), readCache: vi.fn(), writeCache: vi.fn() }))
vi.mock('@/lib/cache/server-json-cache', () => ({
  readServerJsonCache: mocks.readCache,
  writeServerJsonCache: mocks.writeCache,
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.chat } }
  },
}))

describe('AI model catalog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.readCache.mockResolvedValue(null)
  })

  afterEach(() => {
    updateFireworksModels([])
    updateOllamaModels([])
    updateOpenRouterModels([])
    updateVLLMModels([])
    vi.unstubAllGlobals()
  })

  it('contains the active catalog for the existing providers with valid defaults and unique IDs', () => {
    const counts = Object.fromEntries(
      Object.entries(PROVIDER_DEFINITIONS).map(([id, provider]) => [id, provider.models.length])
    )
    expect(counts).toEqual({
      fireworks: 2,
      openrouter: 0,
      vllm: 0,
      openai: 26,
      anthropic: 5,
      'azure-openai': 24,
      'azure-anthropic': 13,
      google: 13,
      vertex: 12,
      deepseek: 2,
      xai: 7,
      cerebras: 2,
      groq: 4,
      mistral: 7,
      ollama: 0,
      bedrock: 37,
    })
    const models = Object.values(PROVIDER_DEFINITIONS).flatMap((provider) => provider.models)
    expect(models).toHaveLength(154)
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length)
    const allProviders = getAllModelProviders()
    const baseProviders = getBaseModelProviders()
    for (const [id, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
      if (provider.models.length && provider.defaultModel) {
        expect(getProviderModels(id)).toContain(provider.defaultModel)
      }
      for (const model of provider.models) {
        expect(getProviderFromModel(model.id)).toBe(id)
        expect(allProviders[model.id]).toBe(id)
        expect(getModelPricing(model.id)).not.toBeNull()
        if (!(DYNAMIC_MODEL_PROVIDERS as readonly string[]).includes(id)) {
          expect(baseProviders[model.id]).toBe(id)
        }
      }
    }
    expect(getProviderDefaultModel('anthropic')).toBe('claude-sonnet-5-5')
    expect(getProviderDefaultModel('deepseek')).toBe('deepseek-flash')
  })

  it.each([
    '',
    '{{MODEL}}',
    'gpt-5-custom',
    'gpt-5.4-2026-03-05',
    'GPT-4.1',
    ' gpt-4.1 ',
    'claude-sonnet-5',
    'claude-haiku-4-5-20251001',
    'deepseek-v4-flash',
    'deepseek-chat',
    'deepseek-reasoner',
    'azure/model-router',
    'labs-leanstral-1-5',
  ])('rejects uncatalogued static IDs and aliases: %s', (model) => {
    expect(() => getProviderFromModel(model)).toThrow('Unknown AI model:')
    expect(getProviderIcon(model)).toBeNull()
    expect(getModelCapabilities(model)).toBeNull()
    expect(getModelPricing(model)).toBeNull()
    expect(getReasoningEffortValuesForModel(model)).toBeNull()
    expect(getVerbosityValuesForModel(model)).toBeNull()
    expect(getThinkingCapability(model)).toBeNull()
    expect(() => getMaxOutputTokensForModel(model)).toThrow('No output token limit defined')
  })

  it('rejects unknown providers and keeps known model icons', () => {
    expect(() => getProviderModels('unknown')).toThrow('Unknown AI provider:')
    expect(() => getProviderDefaultModel('unknown')).toThrow('Unknown AI provider:')
    expect(getProviderIcon('gpt-4.1')).toBe(PROVIDER_DEFINITIONS.openai.icon)
    expect(getModelPricing('openrouter/openai/gpt-4.1')).toBeNull()
  })

  it.each([
    ['ollama', 'ollama/ExampleModel', 2],
    ['vllm', 'vllm/custom-model', 2],
    ['openrouter', 'openrouter/publisher/custom-model', undefined],
    ['fireworks', 'fireworks/accounts/acme/models/custom', 2],
    ['fireworks', 'fireworks/accounts/acme/deployments/prod', 2],
    ['fireworks', 'fireworks/accounts/acme/models/adapter#accounts/acme/deployments/gpu', 2],
  ])('routes qualified %s models before client discovery', (provider, model, temperature) => {
    expect(getProviderFromModel(model)).toBe(provider)
    expect(getModelCapabilities(model)?.temperature).toEqual(
      temperature === undefined ? undefined : { min: 0, max: temperature }
    )
    expect(getMaxTemperature(model)).toBe(temperature)
    expect(() => getProviderFromModel(`${provider}/`)).toThrow('Unknown AI model:')
  })

  it('uses exact discovered IDs while keeping dynamic models out of the base catalog', () => {
    const model = 'ollama/ExampleModel'
    updateOllamaModels([model])
    expect(getProviderModels('ollama')).toEqual([model])
    expect(getAllModelProviders()[model]).toBe('ollama')
    expect(getBaseModelProviders()).not.toHaveProperty(model)
    expect(getModelPricing('ollama/examplemodel')).toBeNull()
  })

  it('preserves canonical Fireworks entries during discovery without inventing custom pricing', () => {
    const models = getProviderModels('fireworks')
    const customModel = 'fireworks/accounts/acme/models/custom'
    expect(models).toEqual([
      'fireworks/accounts/fireworks/models/glm-5p3',
      'fireworks/accounts/fireworks/models/kimi-k3',
    ])
    expect(getReasoningEffortValuesForModel(models[0])).toEqual(['low', 'high', 'max'])
    expect(getReasoningEffortValuesForModel(models[1])).toEqual(['none', 'low', 'high', 'max'])
    updateFireworksModels([models[0], customModel])
    expect(getProviderModels('fireworks')).toEqual([...models, customModel])
    expect(getModelPricing(customModel)).toBeNull()
  })

  it.each([
    [
      { prompt: '0.000007', completion: '0.000014' },
      { input: 7, output: 14 },
    ],
    [
      { prompt: '0', completion: '0' },
      { input: 0, output: 0 },
    ],
    [
      { prompt: '0.000007', completion: '0.000014', input_cache_read: '0.00000175' },
      { input: 7, cachedInput: 1.75, output: 14 },
    ],
    [
      { prompt: '0.000007', completion: '0.000014', input_cache_read: '0' },
      { input: 7, cachedInput: 0, output: 14 },
    ],
    ...['invalid', 'Infinity', '-1'].map(
      (input_cache_read) =>
        [
          { prompt: '0.000007', completion: '0.000014', input_cache_read },
          { input: 7, output: 14 },
        ] as const
    ),
    [undefined, null],
    [{ prompt: '0' }, null],
    [{ prompt: 'invalid', completion: '0' }, null],
    [{ prompt: 'Infinity', completion: '0' }, null],
  ] as const)('uses only OpenRouter discovery pricing: %j', async (pricing, expected) => {
    const fetchMock = vi.mocked(fetch).mockClear()
    fetchMock.mockResolvedValueOnce(Response.json({ data: [{ id: 'openai/gpt-4.1', pricing }] }))
    const response = await GET()
    expect(response.status).toBe(200)
    vi.stubGlobal('window', {})
    fetchMock.mockResolvedValueOnce(response)
    await useProvidersStore.getState().fetchModels('openrouter')
    const model = 'openrouter/openai/gpt-4.1'
    expect(useProvidersStore.getState().providers.openrouter.models).toContain(model)
    if (expected) {
      expect(getModelPricing(model)).toEqual(expected)
      expect(calculateCost(model, 1_000_000, 1_000_000).total).toBeCloseTo(
        expected.input + expected.output,
        8
      )
    } else {
      expect(getModelPricing(model)).toBeNull()
    }
  })

  it('persists discovered OpenRouter capabilities through the API and client store', async () => {
    const fetchMock = vi.mocked(fetch).mockClear()
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            id: 'openai/gpt-4.1',
            supported_parameters: ['temperature', 'tools'],
          },
          {
            id: 'openai/gpt-5.6-sol',
            supported_parameters: ['reasoning_effort', 'verbosity', 'tools'],
            reasoning: {
              supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
            },
          },
        ],
      })
    )

    const response = await GET()
    expect(response.status).toBe(200)
    const catalog = await response.clone().json()
    expect(catalog.capabilities).toEqual({
      'openrouter/openai/gpt-4.1': {
        temperature: { min: 0, max: 2 },
      },
      'openrouter/openai/gpt-5.6-sol': {
        reasoningEffort: {
          values: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
        },
        verbosity: { values: ['low', 'medium', 'high'] },
      },
    })

    updateOpenRouterModels([])
    vi.stubGlobal('window', {})
    fetchMock.mockResolvedValueOnce(response)
    await useProvidersStore.getState().fetchModels('openrouter')

    expect(getModelCapabilities('openrouter/openai/gpt-4.1')).toEqual({
      toolUsageControl: true,
      temperature: { min: 0, max: 2 },
    })
    expect(getModelCapabilities('openrouter/openai/gpt-5.6-sol')).toEqual({
      toolUsageControl: true,
      reasoningEffort: {
        values: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
      },
      verbosity: { values: ['low', 'medium', 'high'] },
    })
  })

  it.each([
    {
      model: 'openrouter/openai/gpt-4.1',
      discovered: {
        id: 'openai/gpt-4.1',
        supported_parameters: ['temperature'],
      },
      expected: { temperature: 0.4 },
      omitted: ['reasoning_effort', 'verbosity'],
    },
    {
      model: 'openrouter/openai/gpt-5.6-sol',
      discovered: {
        id: 'openai/gpt-5.6-sol',
        supported_parameters: ['reasoning_effort', 'verbosity'],
        reasoning: { supported_efforts: ['high', 'medium', 'low'] },
      },
      expected: { reasoning_effort: 'high', verbosity: 'low' },
      omitted: ['temperature'],
    },
  ])('sanitizes cold-server controls and forwards $model payload fields', async (testCase) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [testCase.discovered] }))
    mocks.chat.mockResolvedValueOnce({ choices: [{ message: { content: 'Done' } }] })

    const result = await executeProviderRequest('openrouter', {
      model: testCase.model,
      apiKey: 'test-key',
      context: 'Analyze',
      temperature: 0.4,
      reasoningEffort: 'high',
      verbosity: 'low',
    })

    if ('stream' in result) throw new Error('Expected nonstreaming response')
    expect(result.content).toBe('Done')
    const payload = mocks.chat.mock.calls[0][0]
    expect(payload).toMatchObject(testCase.expected)
    for (const field of testCase.omitted) expect(payload[field]).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 503])('reports failed OpenRouter discovery (%s)', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }))
    expect((await GET()).status).toBe(502)
  })

  it.each(
    [false, true].flatMap((stream) =>
      (
        [
          [undefined, 0.0007],
          [0, 0.0007],
          [50, 0.0004375],
          [100, 0.000175],
        ] as const
      ).map(([cachedTokens, inputCost]) => ({ stream, cachedTokens, inputCost }))
    )
  )(
    'prices fresh-server OpenRouter execution before browser discovery (stream=$stream, cached=$cachedTokens)',
    async ({ stream, cachedTokens, inputCost }) => {
      const model = 'openrouter/openai/gpt-4.1'
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: 'openai/gpt-4.1',
              pricing: {
                prompt: '0.000007',
                completion: '0.000014',
                input_cache_read: '0.00000175',
              },
            },
          ],
        })
      )
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        ...(cachedTokens === undefined
          ? {}
          : { prompt_tokens_details: { cached_tokens: cachedTokens } }),
      }
      mocks.chat.mockImplementationOnce(() => {
        expect(getModelPricing(model)).toEqual({ input: 7, cachedInput: 1.75, output: 14 })
        return stream
          ? (async function* () {
              yield { choices: [{ delta: { content: 'Done' } }] }
              yield { choices: [], usage }
            })()
          : { choices: [{ message: { content: 'Done' } }], usage }
      })

      expect(getModelPricing(model)).toBeNull()
      const result = await executeProviderRequest('openrouter', {
        model,
        apiKey: 'test-key',
        context: 'Analyze',
        stream,
      })
      const output = 'stream' in result ? result.execution.output : result
      if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
      expect(output.cost).toMatchObject({
        input: inputCost,
        output: 0.00028,
        pricing: { input: 7, cachedInput: 1.75, output: 14 },
      })
      expect(output.cost.total).toBeCloseTo(inputCost + 0.00028, 8)
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({ cache: 'no-store' })
      )
      const catalog = mocks.writeCache.mock.calls[0][1]
      expect(mocks.writeCache).toHaveBeenCalledExactlyOnceWith('ai:openrouter:models', catalog, 300)
      updateOpenRouterModels([])
      mocks.readCache.mockResolvedValueOnce(catalog)
      expect(await getOpenRouterModels()).toEqual(catalog)
      expect(getModelPricing(model)).toEqual({ input: 7, cachedInput: 1.75, output: 14 })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each(
    [new Error('Catalog unavailable'), new DOMException('Timed out', 'TimeoutError'), 503].flatMap(
      (failure) => [false, true].map((stream) => ({ failure, stream }))
    )
  )(
    'continues inference and retries failed discovery: $failure, stream=$stream',
    async ({ failure, stream }) => {
      vi.mocked(fetch)
        .mockImplementationOnce(async () => {
          if (failure instanceof Error) throw failure
          return new Response(null, { status: failure })
        })
        .mockResolvedValueOnce(Response.json({ data: [] }))
      const model = 'openrouter/openai/gpt-4.1'
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      mocks.chat.mockResolvedValueOnce(
        stream
          ? (async function* () {
              yield { choices: [{ delta: { content: 'Done' } }] }
              yield { choices: [], usage }
            })()
          : { choices: [{ message: { content: 'Done' } }], usage }
      )
      const result = await executeProviderRequest('openrouter', {
        model,
        apiKey: 'test-key',
        context: 'Analyze',
        stream,
      })
      if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
      else expect(result.content).toBe('Done')
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      expect(getModelPricing(model)).toBeNull()
      expect(mocks.writeCache).not.toHaveBeenCalled()
      await expect(getOpenRouterModels()).resolves.toEqual({
        models: [],
        pricing: {},
        capabilities: {},
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  )
})
