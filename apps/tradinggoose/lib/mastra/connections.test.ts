import { Agent } from '@mastra/core/agent'
import { defaultGateways, ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  managedServices,
  setManagedAzure,
  setManagedProviders,
} from './__test-utils__/managed-services'
import {
  createConfiguredLanguageModel,
  getConfiguredProviders,
  resolveConfiguredModel,
} from './connections'
import { safeInferenceError } from './errors'
import { NATIVE_AGENT_POLICY, parseProviderOptions, trustedModelSettings } from './options'
import { assertListedModel, getModelRegistry } from './registry'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const endpoint = (models = ['org/exact:model']) => ({
  name: 'Managed',
  url: 'http://local.invalid/v1',
  models,
})
const stream = () =>
  new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })

describe('DB-managed native connections', () => {
  it.each(['github', 'resend', 'e2b'])(
    'rejects a custom provider using the unrelated %s service identity before reading its key',
    async (id) => {
      setManagedProviders({ [id]: endpoint() })
      managedServices.credentials[id] = { apiKey: 'unrelated-secret', token: 'unrelated-token' }
      await expect(resolveConfiguredModel(`${id}/org/exact:model`)).rejects.toThrow(
        'non-model System Service'
      )
      expect(managedServices.readConfig).not.toHaveBeenCalled()
      expect(managedServices.decrypt).not.toHaveBeenCalled()
    }
  )
  it('retains the native provider service as its credential owner', async () => {
    setManagedProviders({ mistral: endpoint() })
    managedServices.credentials.mistral = { apiKey: 'managed-model-key' }
    expect((await resolveConfiguredModel('mistral/org/exact:model')).apiKey).toBe(
      'managed-model-key'
    )
  })
  it.each([
    'private-token-not-json',
    '{"local":"private-token"',
    '{"local":{"key":"private-token"}}',
  ])('keeps malformed managed key bundles out of inference errors: %s', async (apiKeys) => {
    setManagedProviders({ local: endpoint() })
    managedServices.credentials.mastra_model_providers = { apiKeys }
    const error = await resolveConfiguredModel('local/org/exact:model').catch((error) => error)
    expect(safeInferenceError(error)).toBe(
      'Managed model API keys must be a JSON object of provider IDs and keys in System Services'
    )
    expect(safeInferenceError(error)).not.toContain('private-token')
  })
  it('lists built-in identities without loading or exposing credentials', async () => {
    await expect(assertListedModel('openai/gpt-4o')).resolves.toBeUndefined()
    expect(await getModelRegistry()).not.toHaveLength(0)
    expect(managedServices.readConfig).not.toHaveBeenCalled()
    expect(managedServices.decrypt).not.toHaveBeenCalled()
  })
  it.each(['unknown', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects unlisted %s membership',
    async (provider) => {
      await expect(assertListedModel(`${provider}/missing`)).rejects.toMatchObject({ status: 400 })
    }
  )
  it('accepts exact explicitly managed prototype-like identities', async () => {
    setManagedProviders({ constructor: endpoint(['listed']) })
    await expect(assertListedModel('constructor/listed')).resolves.toBeUndefined()
    await expect(assertListedModel('constructor/missing')).rejects.toMatchObject({ status: 400 })
    expect(await resolveConfiguredModel('constructor/listed', 'request-key')).toMatchObject({
      providerId: 'constructor',
      modelId: 'listed',
      url: 'http://local.invalid/v1',
      apiKey: 'request-key',
    })
  })
  it.each(defaultGateways.map(({ id }) => id))(
    'rejects reserved gateway %s before model contact',
    async (provider) => {
      setManagedProviders({ [provider]: endpoint() })
      vi.stubGlobal('fetch', vi.fn())
      await expect(getConfiguredProviders()).rejects.toThrow('reserved')
      await expect(
        createConfiguredLanguageModel(`${provider}/org/exact:model`, 'caller-key')
      ).rejects.toThrow('reserved')
      expect(fetch).not.toHaveBeenCalled()
    }
  )
  it.each(['local', 'ollama', 'vllm', 'openai'])(
    'preserves exact %s identity, native sampling and BYOK precedence',
    async (provider) => {
      const modelId = provider === 'openai' ? 'gpt-4.1' : 'org/exact:model'
      if (provider === 'ollama' || provider === 'vllm') {
        managedServices.settings[provider] = {
          baseUrl: 'http://local.invalid/v1',
          models: JSON.stringify([modelId]),
        }
        managedServices.credentials[provider] = { apiKey: 'managed-key' }
      } else setManagedProviders({ [provider]: endpoint([modelId]) })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => stream())
      )
      await assertListedModel(`${provider}/${modelId}`)
      await expect(assertListedModel(`${provider}/unlisted`)).rejects.toThrow('Select a listed')
      const metadata = (await getModelRegistry()).find(({ id }) => id === provider)!
      expect(metadata.models).toEqual([{ id: `${provider}/${modelId}` }])
      expect(JSON.stringify(metadata)).not.toMatch(/local.invalid|managed-key|apiKey|headers/)
      const model = await createConfiguredLanguageModel(`${provider}/${modelId}`, 'caller-key')
      await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        temperature: 0.65,
        topP: 0.8,
      })
      const [url, init] = vi.mocked(fetch).mock.calls[0]
      expect(String(url)).toBe('http://local.invalid/v1/chat/completions')
      expect(JSON.parse(String(init!.body))).toMatchObject({
        model: modelId,
        temperature: 0.65,
        top_p: 0.8,
      })
      expect(new Headers(init!.headers).get('authorization')).toBe('Bearer caller-key')
      expect(managedServices.readConfig).not.toHaveBeenCalled()
    }
  )
  it.each(['custom-chat', 'org/exact:model', 'gpt-5'])(
    'rejects sampling-incompatible openai/%s configuration',
    async (modelId) => {
      setManagedProviders({ openai: endpoint([modelId]) })
      await expect(createConfiguredLanguageModel(`openai/${modelId}`, 'key')).rejects.toThrow(
        'Choose a distinct managed provider ID'
      )
    }
  )
  it('keeps the native built-in sampling policy without a configured override', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream())
    )
    const model = await createConfiguredLanguageModel('openai/gpt-5', 'caller-key')
    await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      temperature: 0.65,
      topP: 0.8,
    })
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body))
    expect(body.model).toBe('gpt-5')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })
  it('reads rotated DB keys without caching or provider environment fallback', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'poison-env')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream())
    )
    await expect(createConfiguredLanguageModel('openai/gpt-4.1')).rejects.toThrow(
      'not configured in System Services'
    )
    expect(fetch).not.toHaveBeenCalled()
    for (const key of ['first-key', 'rotated-key']) {
      managedServices.credentials.openai = { defaultApiKey: key }
      const model = await createConfiguredLanguageModel('openai/gpt-4.1')
      await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      })
    }
    expect(
      vi.mocked(fetch).mock.calls.map(([, init]) => new Headers(init!.headers).get('authorization'))
    ).toEqual(['Bearer first-key', 'Bearer rotated-key'])
    vi.stubEnv('MASTRA_MODEL_PROVIDERS', JSON.stringify({ poison: endpoint() }))
    vi.stubEnv(
      'MASTRA_AZURE_OPENAI',
      JSON.stringify({ resourceName: 'poison', apiKey: 'poison', deployments: ['poison'] })
    )
    expect(await getConfiguredProviders()).toEqual({})
  })
  it('uses encrypted custom keys, while public registry metadata never decrypts them', async () => {
    setManagedProviders({ local: endpoint() })
    managedServices.credentials.mastra_model_providers = {
      apiKeys: JSON.stringify({ local: 'managed-secret' }),
    }
    await getModelRegistry()
    expect(managedServices.decrypt).not.toHaveBeenCalled()
    expect((await resolveConfiguredModel('local/org/exact:model')).apiKey).toBe('managed-secret')
    expect(managedServices.decrypt).toHaveBeenCalledOnce()
  })
  it.each(['ollama', 'vllm'])(
    'allows a keyless managed %s endpoint without inheriting an environment key',
    async (provider) => {
      managedServices.settings[provider] = {
        baseUrl: 'http://local.invalid/v1',
        models: JSON.stringify(['exact']),
      }
      vi.stubEnv('OPENAI_API_KEY', 'poison')
      const config = await resolveConfiguredModel(`${provider}/exact`)
      expect(config.apiKey).toBe('')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => stream())
      )
      await (await createConfiguredLanguageModel(`${provider}/exact`)).doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      })
      expect(
        new Headers(vi.mocked(fetch).mock.calls[0][1]!.headers).get('authorization') ?? ''
      ).not.toContain('poison')
    }
  )
  it('uses the native Azure gateway, fresh managed key and request-local override', async () => {
    setManagedAzure({
      resourceName: 'fixture-resource',
      deployments: ['exact-deployment'],
      apiKey: 'managed-key',
    })
    await assertListedModel('azure-openai/exact-deployment')
    await expect(assertListedModel('azure-openai/wrong')).rejects.toThrow('Select a listed')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream())
    )
    for (const key of ['caller-key', undefined]) {
      const model = await createConfiguredLanguageModel('azure-openai/exact-deployment', key)
      await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      })
    }
    const calls = vi.mocked(fetch).mock.calls
    expect(String(calls[0][0])).toContain('fixture-resource.openai.azure.com')
    expect(String(calls[0][0])).toContain('exact-deployment')
    expect(new Headers(calls[0][1]!.headers).get('api-key')).toBe('caller-key')
    expect(new Headers(calls[1][1]!.headers).get('api-key')).toBe('managed-key')
  })
  it('ignores an unconfigured local default URL and rejects conflicting ownership/plaintext key fields', async () => {
    managedServices.settings.ollama = { baseUrl: 'http://localhost:11434/v1' }
    expect(await getConfiguredProviders()).toEqual({})
    setManagedProviders({ ollama: endpoint() })
    await expect(getConfiguredProviders()).rejects.toThrow('own System Service')
    setManagedProviders({ local: { ...endpoint(), apiKey: 'plaintext' } })
    await expect(getConfiguredProviders()).rejects.toThrow()
  })
  it.each(['local', 'openai'])(
    'keeps exact managed %s embeddings on the native embedding lane',
    async (provider) => {
      setManagedProviders({ [provider]: endpoint(['org/embed']) })
      if (provider === 'openai')
        managedServices.credentials.openai = { defaultApiKey: 'server-key' }
      else
        managedServices.credentials.mastra_model_providers = {
          apiKeys: JSON.stringify({ local: 'server-key' }),
        }
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            data: [{ index: 0, embedding: [1, 2] }],
            usage: { prompt_tokens: 7, total_tokens: 7 },
          })
        )
      )
      const model = new ModelRouterEmbeddingModel(
        await resolveConfiguredModel(`${provider}/org/embed`)
      )
      const result = await model.doEmbed({ values: ['hello'] })
      expect(result.embeddings).toEqual([[1, 2]])
      expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('http://local.invalid/v1/embeddings')
      expect(new Headers(vi.mocked(fetch).mock.calls[0][1]!.headers).get('authorization')).toBe(
        'Bearer server-key'
      )
    }
  )
})

it.each([
  {
    model: 'openai/gpt-5',
    url: 'https://api.openai.com/v1/responses',
    providerOptions: { openai: { reasoningEffort: 'low' } },
    requestOptions: { reasoning: { effort: 'low' } },
    modelSettings: {},
    omitted: [],
  },
  {
    model: 'deepseek/deepseek-reasoner',
    url: 'https://api.deepseek.com/chat/completions',
    providerOptions: { deepseek: { reasoningEffort: 'low', thinking: { type: 'enabled' } } },
    requestOptions: { reasoning_effort: 'low', thinking: { type: 'enabled' } },
    modelSettings: {},
    omitted: [],
  },
  {
    model: 'openai/gpt-4.1',
    url: 'https://api.openai.com/v1/responses',
    providerOptions: {},
    modelSettings: { temperature: '', maxOutputTokens: '' },
    requestOptions: {},
    omitted: ['temperature', 'max_output_tokens'],
  },
  {
    model: 'openai/gpt-4.1',
    url: 'https://api.openai.com/v1/responses',
    providerOptions: {},
    modelSettings: { temperature: '0.5', maxOutputTokens: '128' },
    requestOptions: { temperature: 0.5, max_output_tokens: 128 },
    omitted: [],
  },
])('forwards native generation options through Agent and router for $model', async (fixture) => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(fixture.url)
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject(fixture.requestOptions)
    for (const field of fixture.omitted) expect(body).not.toHaveProperty(field)
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
    model: await createConfiguredLanguageModel(fixture.model, 'request-key'),
  })
  const result = await agent.generate('Hello', {
    providerOptions: parseProviderOptions(fixture.providerOptions),
    modelSettings: trustedModelSettings(fixture.modelSettings),
  })
  expect(result.text).toBe('ok')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [, request] = fetcher.mock.calls[0]
  expect(new Headers(request?.headers).get('authorization')).toBe('Bearer request-key')
})
