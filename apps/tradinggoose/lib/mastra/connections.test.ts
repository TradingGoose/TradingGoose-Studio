import { Agent } from '@mastra/core/agent'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { managedServices } from './__test-utils__/managed-services'
import { createConfiguredLanguageModel, resolveConfiguredModel } from './connections'
import { getModelRegistry } from './registry'
import { prepareModelRequest } from './request'
import { usageProcessors } from './usage-processors'

vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: vi.fn(async () => ({ inputProcessors: [], outputProcessors: [] })),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const stream = () =>
  new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
const requestScope = {
  actorUserId: 'actor',
  runId: 'request',
  purpose: 'workflow-agent',
  funding: 'byok' as const,
}

describe('DB-managed native connections', () => {
  it.each([
    'github',
    'resend',
    'e2b',
    'netlify',
    'databricks',
    'snowflake-cortex',
    'cloudflare-workers-ai',
    'infomaniak',
    'neon',
    'lmstudio',
    'privatemode-ai',
    'lynkr',
    'atomic-chat',
  ])('rejects the unsupported %s service before reading its key', async (id) => {
    managedServices.credentials[id] = { apiKey: 'unrelated-secret', token: 'unrelated-token' }
    for (const apiKey of [undefined, 'request-key'])
      await expect(resolveConfiguredModel(`${id}/missing`, apiKey)).rejects.toThrow(
        'not supported by Studio'
      )
    expect(managedServices.readConfig).not.toHaveBeenCalled()
  })
  it('reads native provider credentials only for inference, never for public registry metadata', async () => {
    managedServices.credentials.mistral = { apiKey: 'managed-model-key' }
    await getModelRegistry()
    expect(managedServices.readConfig).not.toHaveBeenCalled()
    expect(await resolveConfiguredModel('mistral/mistral-large-latest')).toEqual({
      providerId: 'mistral',
      modelId: 'mistral-large-latest',
      apiKey: 'managed-model-key',
    })
    expect(managedServices.readConfig).toHaveBeenCalledWith('mistral')
  })
  it('uses native OpenAI and request-local keys without reading managed credentials', async () => {
    managedServices.credentials.openai = { defaultApiKey: 'managed-key' }
    vi.stubEnv('OPENAI_API_KEY', 'poison-env')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream())
    )
    const model = await createConfiguredLanguageModel('openai/gpt-4.1', 'caller-key')
    await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      temperature: 0.65,
      topP: 0.8,
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(String(init!.body))).toMatchObject({
      model: 'gpt-4.1',
      temperature: 0.65,
      top_p: 0.8,
    })
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer caller-key')
    expect(managedServices.readConfig).not.toHaveBeenCalled()
  })
  it('keeps the native built-in sampling policy', async () => {
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
  it.each([undefined, '', ' \t '])(
    'resolves blank override %j to fresh managed keys without environment credentials',
    async (apiKey) => {
      vi.stubEnv('OPENAI_API_KEY', 'poison-env')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => stream())
      )
      const scope = {
        ...requestScope,
        model: 'openai/gpt-4.1',
        funding: apiKey ? ('byok' as const) : ('account' as const),
      }
      await expect(prepareModelRequest(scope, { apiKey })).rejects.toThrow(
        'not configured in System Services'
      )
      expect(fetch).not.toHaveBeenCalled()
      for (const key of ['first-key', 'rotated-key']) {
        managedServices.credentials.openai = { defaultApiKey: key }
        const { model } = await prepareModelRequest(scope, { apiKey })
        await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        })
      }
      managedServices.credentials.openai = {}
      await expect(prepareModelRequest(scope, { apiKey })).rejects.toThrow(
        'not configured in System Services'
      )
      expect(
        vi
          .mocked(fetch)
          .mock.calls.map(([, init]) => new Headers(init!.headers).get('authorization'))
      ).toEqual(['Bearer first-key', 'Bearer rotated-key'])
      expect(usageProcessors).toHaveBeenLastCalledWith(
        { ...scope, funding: 'account' },
        expect.objectContaining({
          assertAllowed: expect.any(Function),
          begin: expect.any(Function),
          record: expect.any(Function),
        })
      )
    }
  )
  it('uses native OpenAI embeddings with the current managed credential', async () => {
    managedServices.credentials.openai = { defaultApiKey: 'server-key' }
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
      await resolveConfiguredModel('openai/text-embedding-3-small')
    )
    expect((await model.doEmbed({ values: ['hello'] })).embeddings).toEqual([[1, 2]])
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://api.openai.com/v1/embeddings')
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer server-key')
  })
})

it.each([
  {
    model: 'openai/gpt-4.1',
    url: 'https://api.openai.com/v1/responses',
    modelSettings: { temperature: '', maxOutputTokens: '' },
    providerOptions: undefined,
    requestOptions: {},
    omitted: ['temperature', 'max_output_tokens'],
  },
  {
    model: 'openai/gpt-4.1',
    url: 'https://api.openai.com/v1/responses',
    modelSettings: { temperature: '0.5', maxOutputTokens: '128' },
    providerOptions: undefined,
    requestOptions: { temperature: 0.5, max_output_tokens: 128 },
    omitted: [],
  },
  {
    model: 'openai/gpt-5.4',
    url: 'https://api.openai.com/v1/responses',
    modelSettings: {},
    providerOptions: {
      openai: { reasoningEffort: 'high', promptCacheKey: 'native-cache-key', textVerbosity: 'low' },
    },
    requestOptions: {
      reasoning: { effort: 'high' },
      prompt_cache_key: 'native-cache-key',
      text: { verbosity: 'low' },
    },
    omitted: [],
  },
])('forwards native generation options through Agent and router for $model', async (fixture) => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(fixture.url)
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject(fixture.requestOptions)
    for (const field of fixture.omitted) expect(body).not.toHaveProperty(field)
    return Response.json({
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
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const work = await prepareModelRequest(
    { ...requestScope, model: fixture.model },
    {
      apiKey: 'request-key',
      modelSettings: fixture.modelSettings,
      providerOptions: fixture.providerOptions,
    }
  )
  const agent = new Agent({
    id: 'native-model-settings',
    name: 'Native model settings',
    instructions: 'Reply briefly',
    model: work.model,
  })
  const result = await agent.generate('Hello', work.options)
  expect(result.text).toBe('ok')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [, request] = fetcher.mock.calls[0]
  expect(new Headers(request?.headers).get('authorization')).toBe('Bearer request-key')
})

it.each([
  {
    model: 'anthropic/claude-sonnet-4-5',
    providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } },
    requestOptions: { thinking: { type: 'enabled', budget_tokens: 4096 } },
  },
  {
    model: 'google/gemini-2.5-pro',
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 4096, includeThoughts: true } },
    },
    requestOptions: {
      generationConfig: { thinkingConfig: { thinkingBudget: 4096, includeThoughts: true } },
    },
  },
])('delegates native thinking format to the installed $model adapter', async (fixture) => {
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => stream())
  vi.stubGlobal('fetch', fetcher)
  const work = await prepareModelRequest(
    { ...requestScope, model: fixture.model },
    { apiKey: 'request-key', providerOptions: JSON.stringify(fixture.providerOptions) }
  )
  await work.model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    providerOptions: work.options.providerOptions,
  })
  expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body))).toMatchObject(fixture.requestOptions)
})
