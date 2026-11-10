import { ModelRouterEmbeddingModel, ModelRouterLanguageModel } from '@mastra/core/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConfiguredGateways, resolveConfiguredModel } from './connections'
import { assertListedModel, getModelRegistry } from './registry'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('configured native connections', () => {
  it('accepts an exact built-in model through the installed registry', () => {
    vi.stubEnv('MASTRA_MODEL_PROVIDERS', '{}')
    expect(() => assertListedModel('openai/gpt-4o')).not.toThrow()
  })

  it.each(['unknown', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects the unlisted %s provider through the installed registry',
    (providerId) => {
      vi.stubEnv('MASTRA_MODEL_PROVIDERS', '{}')
      expect(() => assertListedModel(`${providerId}/missing`)).toThrowError(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining('Select a listed provider/model'),
        })
      )
    }
  )

  it('accepts an explicitly configured constructor provider with exact membership', () => {
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        constructor: {
          name: 'Constructor',
          url: 'http://local.invalid/v1',
          models: ['listed'],
        },
      })
    )
    expect(() => assertListedModel('constructor/listed')).not.toThrow()
    expect(() => assertListedModel('constructor/missing')).toThrowError(
      expect.objectContaining({ status: 400 })
    )
    expect(getModelRegistry().find(({ id }) => id === 'constructor')).toMatchObject({
      name: 'Constructor',
      models: [{ id: 'constructor/listed' }],
    })
    expect(resolveConfiguredModel('constructor/listed')).toMatchObject({
      providerId: 'constructor',
      modelId: 'listed',
      url: 'http://local.invalid/v1',
    })
  })

  it.each(['ollama', 'vllm'])(
    'executes only configured %s IDs through native OpenAI-compatible routing',
    async (provider) => {
      vi.stubEnv(
        'MASTRA_MODEL_PROVIDERS',
        JSON.stringify({
          [provider]: {
            name: 'Local',
            url: 'http://local.invalid/v1',
            models: ['exact:model'],
            apiKeyEnvVar: ['LOCAL_KEY'],
          },
        })
      )
      vi.stubEnv('LOCAL_KEY', 'server-key')
      const fetcher = vi.fn(
        async () =>
          new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      )
      vi.stubGlobal('fetch', fetcher)
      assertListedModel(`${provider}/exact:model`)
      expect(() => assertListedModel(`${provider}/unlisted`)).toThrow('Select a listed')
      const registry = getModelRegistry().find(({ id }) => id === provider)!
      expect(registry.models.map(({ id }) => id)).toEqual([`${provider}/exact:model`])
      expect(JSON.stringify(registry)).not.toMatch(/local.invalid|server-key|LOCAL_KEY/)
      const native = new ModelRouterLanguageModel(
        resolveConfiguredModel(`${provider}/exact:model`, 'caller-key')
      )
      await native.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      })
      const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(String(url)).toBe('http://local.invalid/v1/chat/completions')
      expect(JSON.parse(request.body as string).model).toBe('exact:model')
      expect(new Headers(request.headers).get('authorization')).toBe('Bearer caller-key')
      expect(process.env.LOCAL_KEY).toBe('server-key')
    }
  )

  it('uses the native Azure gateway and exact configured deployment with a local key override', async () => {
    vi.stubEnv(
      'MASTRA_AZURE_OPENAI',
      JSON.stringify({
        resourceName: 'fixture-resource',
        apiKey: 'server-key',
        deployments: ['exact-deployment'],
      })
    )
    const gateways = getConfiguredGateways()
    expect((await gateways['azure-openai'].fetchProviders())['azure-openai'].models).toEqual([
      'exact-deployment',
    ])
    expect(
      getModelRegistry()
        .find(({ id }) => id === 'azure-openai')!
        .models.map(({ id }) => id)
    ).toEqual(['azure-openai/exact-deployment'])
    assertListedModel('azure-openai/exact-deployment')
    expect(() => assertListedModel('azure-openai/wrong')).toThrow('Select a listed')
    const fetcher = vi.fn(
      async () =>
        new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    )
    vi.stubGlobal('fetch', fetcher)
    const native = new ModelRouterLanguageModel(
      resolveConfiguredModel('azure-openai/exact-deployment', 'caller-key'),
      Object.values(gateways)
    )
    await native.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('fixture-resource.openai.azure.com')
    expect(String(url)).toContain('exact-deployment')
    expect(new Headers(request.headers).get('api-key')).toBe('caller-key')
  })
})

it('uses the same configured local connection for native embeddings', async () => {
  vi.stubEnv(
    'MASTRA_MODEL_PROVIDERS',
    JSON.stringify({
      local: {
        name: 'Local',
        url: 'http://local.invalid/v1',
        models: ['org/embed'],
        apiKeyEnvVar: ['LOCAL_KEY'],
      },
    })
  )
  vi.stubEnv('LOCAL_KEY', 'server-key')
  const fetcher = vi.fn(async () =>
    Response.json({
      data: [{ index: 0, embedding: [1, 2] }],
      usage: { prompt_tokens: 7, total_tokens: 7 },
    })
  )
  vi.stubGlobal('fetch', fetcher)
  const native = new ModelRouterEmbeddingModel(resolveConfiguredModel('local/org/embed'))
  const result = await native.doEmbed({ values: ['hello'] })
  expect(result.embeddings).toEqual([[1, 2]])
  expect(result.usage?.tokens).toBe(7)
  const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(String(url)).toBe('http://local.invalid/v1/embeddings')
  expect(new Headers(request.headers).get('authorization')).toBe('Bearer server-key')
})
