import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/providers/ai/openrouter/models/route'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getAllModelProviders,
  getBaseModelProviders,
  getMaxOutputTokensForModel,
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
import { openRouterProvider } from '@/providers/ai/openrouter'
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
      fireworks: 3,
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
      cerebras: 4,
      groq: 7,
      mistral: 27,
      ollama: 0,
      bedrock: 37,
    })
    const models = Object.values(PROVIDER_DEFINITIONS).flatMap((provider) => provider.models)
    expect(models).toHaveLength(180)
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
    ['ollama', 'ollama/ExampleModel'],
    ['vllm', 'vllm/custom-model'],
    ['openrouter', 'openrouter/publisher/custom-model'],
    ['fireworks', 'fireworks/accounts/acme/models/custom'],
  ])('routes qualified %s models before client discovery', (provider, model) => {
    expect(getProviderFromModel(model)).toBe(provider)
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
      'fireworks/accounts/fireworks/models/glm-5p2',
      'fireworks/accounts/fireworks/models/kimi-k3',
    ])
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
      expect(getModelPricing(model)).toMatchObject(expected)
      expect(calculateCost(model, 1_000_000, 1_000_000).total).toBeCloseTo(
        expected.input + expected.output,
        8
      )
    } else {
      expect(getModelPricing(model)).toBeNull()
    }
  })

  it.each([401, 503])('reports failed OpenRouter discovery (%s)', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }))
    expect((await GET()).status).toBe(502)
  })

  it.each([false, true])(
    'prices fresh-server OpenRouter execution before browser discovery (stream=%s)',
    async (stream) => {
      const model = 'openrouter/openai/gpt-4.1'
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          data: [{ id: 'openai/gpt-4.1', pricing: { prompt: '0.000007', completion: '0.000014' } }],
        })
      )
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      mocks.chat.mockImplementationOnce(() => {
        expect(getModelPricing(model)).toEqual({ input: 7, output: 14 })
        return stream
          ? (async function* () {
              yield { choices: [{ delta: { content: 'Done' } }] }
              yield { choices: [], usage }
            })()
          : { choices: [{ message: { content: 'Done' } }], usage }
      })

      expect(getModelPricing(model)).toBeNull()
      const [result, catalog] = await Promise.all([
        openRouterProvider.executeRequest({
          model,
          apiKey: 'test-key',
          context: 'Analyze',
          stream,
        }),
        getOpenRouterModels(),
      ])
      const output = 'stream' in result ? result.execution.output : result
      if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
      expect(output.cost).toMatchObject({
        input: 0.0007,
        output: 0.00028,
        total: 0.00098,
        pricing: { input: 7, output: 14 },
      })
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({ cache: 'no-store' })
      )
      expect(mocks.writeCache).toHaveBeenCalledExactlyOnceWith('ai:openrouter:models', catalog, 300)
      updateOpenRouterModels([])
      mocks.readCache.mockResolvedValueOnce(catalog)
      expect(await getOpenRouterModels()).toEqual(catalog)
      expect(getModelPricing(model)).toEqual({ input: 7, output: 14 })
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
      const result = await openRouterProvider.executeRequest({
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
      await expect(getOpenRouterModels()).resolves.toEqual({ models: [], pricing: {} })
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  )
})
