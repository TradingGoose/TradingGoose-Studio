import { Agent } from '@mastra/core/agent'
import { ModelRouterEmbeddingModel, ModelRouterLanguageModel } from '@mastra/core/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConfiguredLanguageModel,
  getConfiguredGateways,
  resolveConfiguredModel,
} from './connections'
import { NATIVE_AGENT_POLICY, parseProviderOptions } from './options'
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
            models: ['org/exact:model'],
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
      assertListedModel(`${provider}/org/exact:model`)
      expect(() => assertListedModel(`${provider}/unlisted`)).toThrow('Select a listed')
      const registry = getModelRegistry().find(({ id }) => id === provider)!
      expect(registry.models.map(({ id }) => id)).toEqual([`${provider}/org/exact:model`])
      expect(JSON.stringify(registry)).not.toMatch(/local.invalid|server-key|LOCAL_KEY/)
      const native = new ModelRouterLanguageModel(
        resolveConfiguredModel(`${provider}/org/exact:model`, 'caller-key')
      )
      await native.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      })
      const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(String(url)).toBe('http://local.invalid/v1/chat/completions')
      expect(JSON.parse(request.body as string).model).toBe('org/exact:model')
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
  expect(JSON.parse(request.body as string).model).toBe('org/embed')
  expect(new Headers(request.headers).get('authorization')).toBe('Bearer server-key')
})

it.each([
  {
    model: 'openai/gpt-5',
    url: 'https://api.openai.com/v1/responses',
    providerOptions: { openai: { reasoningEffort: 'low' } },
    requestOptions: { reasoning: { effort: 'low' } },
  },
  {
    model: 'deepseek/deepseek-reasoner',
    url: 'https://api.deepseek.com/chat/completions',
    providerOptions: { deepseek: { reasoningEffort: 'low', thinking: { type: 'enabled' } } },
    requestOptions: { reasoning_effort: 'low', thinking: { type: 'enabled' } },
  },
])('forwards native provider options through Agent and router for $model', async (fixture) => {
  vi.stubEnv('MASTRA_MODEL_PROVIDERS', '{}')
  vi.stubEnv('MASTRA_AZURE_OPENAI', '')
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(fixture.url)
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject(fixture.requestOptions)
    return Response.json(
      fixture.model.startsWith('openai/')
        ? {
            id: 'resp_fixture',
            object: 'response',
            created_at: 0,
            model: body.model,
            status: 'completed',
            output: [
              {
                id: 'msg_fixture',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'ok', annotations: [] }],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          }
        : {
            id: 'chatcmpl_fixture',
            object: 'chat.completion',
            created: 0,
            model: body.model,
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }
    )
  })
  vi.stubGlobal('fetch', fetcher)
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'native-provider-options',
    name: 'Native provider options',
    instructions: 'Reply briefly',
    model: createConfiguredLanguageModel(fixture.model, 'request-key'),
  })
  const result = await agent.generate('Hello', {
    providerOptions: parseProviderOptions(fixture.providerOptions),
  })
  expect(result.text).toBe('ok')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [, request] = fetcher.mock.calls[0]
  expect(new Headers(request?.headers).get('authorization')).toBe('Bearer request-key')
})
