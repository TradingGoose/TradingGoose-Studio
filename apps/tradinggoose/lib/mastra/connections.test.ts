import { getCatalogThinkingLevels } from '@mastra/code-sdk/thinking-catalog'
import { Agent } from '@mastra/core/agent'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { managedServices } from './__test-utils__/managed-services'
import { resolveConfiguredModel } from './connections'
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
    const { model } = await prepareModelRequest(
      { ...requestScope, model: 'openai/gpt-4.1' },
      { apiKey: 'caller-key' }
    )
    await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(String(init!.body)).model).toBe('gpt-4.1')
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer caller-key')
    expect(managedServices.readConfig).not.toHaveBeenCalled()
  })
  it.each([
    ['openai/gpt-5', false],
    ['opencode-go/gemini-4-argon', false],
    ['concentrate/codestral', true],
  ] as const)(
    'uses the selected catalog route for sampling on %s',
    async (model, supportsSampling) => {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => stream())
      vi.stubGlobal('fetch', fetcher)
      const work = await prepareModelRequest(
        { ...requestScope, model, purpose: 'workflow-router' },
        { apiKey: 'caller-key', modelSettings: { temperature: 0.65, topP: 0.8 } }
      )
      const agent = new Agent({
        id: 'sampling',
        name: 'sampling',
        instructions: '',
        model: work.model,
      })
      const response = await agent.stream('hello', work.options)
      await response.consumeStream()
      expect(fetcher).toHaveBeenCalledOnce()
      const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body))
      const settings = body.generationConfig ?? body
      expect(settings.temperature).toBe(supportsSampling ? 0.65 : undefined)
      expect(settings.top_p ?? settings.topP).toBe(supportsSampling ? 0.8 : undefined)
    }
  )
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
    requestOptions: {},
    omitted: ['temperature', 'max_output_tokens', 'reasoning'],
  },
  {
    model: 'openai/gpt-4.1',
    url: 'https://api.openai.com/v1/responses',
    modelSettings: { temperature: '0.5', maxOutputTokens: '128' },
    requestOptions: { temperature: 0.5, max_output_tokens: 128 },
    omitted: [],
  },
])(
  'forwards native generation options through Agent and router for $model ($modelSettings)',
  async (fixture) => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
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
      { ...requestScope, purpose: 'workflow-router', model: fixture.model },
      {
        apiKey: 'request-key',
        modelSettings: fixture.modelSettings,
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
    const [url, request] = fetcher.mock.calls[0]
    expect(String(url)).toBe(fixture.url)
    const body = JSON.parse(request!.body as string)
    expect(body).toMatchObject({
      model: fixture.model.slice('openai/'.length),
      ...fixture.requestOptions,
    })
    for (const field of fixture.omitted) expect(body).not.toHaveProperty(field)
    expect(work.options).not.toHaveProperty('providerOptions')
    expect(usageProcessors).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: fixture.model }),
      expect.anything()
    )
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer request-key')
  }
)

it.each(['openai/gpt-5', 'google/gemini-2.5-flash', 'deepseek/deepseek-v4-flash'])(
  'serializes each Mastra Code SDK level for %s',
  async (id) => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => stream())
    vi.stubGlobal('fetch', fetcher)
    const settings = new Set<string>()
    for (const value of getCatalogThinkingLevels(id).filter((level) => level !== 'off')) {
      const { model, options } = await prepareModelRequest(
        { ...requestScope, model: id },
        { apiKey: 'fixture', reasoning: { type: 'effort', value } }
      )
      const agent = new Agent({ id: 'levels', name: 'Levels', instructions: '', model })
      await (await agent.stream('hello', options)).consumeStream()
      const [url, request] = fetcher.mock.lastCall!
      const body = JSON.parse(String(request!.body))
      expect(JSON.stringify(body)).not.toContain('"temperature":')
      expect(body.model ?? decodeURIComponent(String(url))).toContain(id.split('/')[1])
      const applied =
        body.reasoning ?? body.reasoning_effort ?? body.generationConfig?.thinkingConfig
      expect(applied).toBeDefined()
      if (id === 'openai/gpt-5') expect(applied.effort).toBe(value)
      settings.add(JSON.stringify(applied))
    }
    expect(fetcher.mock.calls.length).toBeGreaterThan(1)
    expect(settings.size).toBe(fetcher.mock.calls.length)
  }
)

it.each(['workflow-agent', 'copilot'] as const)(
  'prepares %s for a model without levels',
  async (purpose) => {
    const id = 'openai/gpt-4o'
    const { model, options } = await prepareModelRequest(
      { ...requestScope, model: id, purpose },
      { apiKey: 'fixture' }
    )
    expect(model.modelId).toBe('gpt-4o')
    expect(options).not.toHaveProperty('maxSteps')
    expect(options).not.toHaveProperty('prepareStep')
    expect(options.modelSettings).not.toHaveProperty('reasoning')
  }
)

it.each([
  { model: 'openai/gpt-4.1', value: 'high' },
  { model: 'deepseek/deepseek-v4-flash', value: 'medium' },
  { model: 'openai/gpt-5', value: 'max' },
] as const)(
  'rejects unpublished effort $value on $model before accounting',
  async ({ model, value }) => {
    vi.mocked(usageProcessors).mockClear()
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      prepareModelRequest(
        { ...requestScope, model },
        { apiKey: 'fixture', reasoning: { type: 'effort', value } }
      )
    ).rejects.toThrow(/reasoning/i)
    expect(usageProcessors).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }
)
