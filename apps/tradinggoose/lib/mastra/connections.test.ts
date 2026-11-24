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
    reasoning: undefined,
    requestOptions: {},
    omitted: ['temperature', 'max_output_tokens'],
  },
  {
    model: 'openai/gpt-4.1',
    url: 'https://api.openai.com/v1/responses',
    modelSettings: { temperature: '0.5', maxOutputTokens: '128' },
    reasoning: undefined,
    requestOptions: { temperature: 0.5, max_output_tokens: 128 },
    omitted: [],
  },
  {
    model: 'openai/gpt-5.4',
    url: 'https://api.openai.com/v1/responses',
    modelSettings: {},
    reasoning: { type: 'effort', value: 'high' } as const,
    requestOptions: { reasoning: { effort: 'high' } },
    omitted: [],
  },
  ...['openai/gpt-daybreak-blue-latest', 'openai/gpt-daybreak-red-latest'].flatMap((model) =>
    (['none', 'high', undefined] as const).map((value) => ({
      model,
      url: 'https://api.openai.com/v1/responses',
      modelSettings: {},
      reasoning: value && { type: 'effort' as const, value },
      requestOptions: value ? { reasoning: { effort: value } } : {},
      omitted: value ? [] : ['reasoning'],
    }))
  ),
])(
  'forwards native generation options through Agent and router for $model ($reasoning)',
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
      { ...requestScope, model: fixture.model },
      {
        apiKey: 'request-key',
        modelSettings: fixture.modelSettings,
        reasoning: fixture.reasoning,
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
    if (!fixture.reasoning) expect(work.options.providerOptions).toBeUndefined()
    expect(usageProcessors).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: fixture.model }),
      expect.anything()
    )
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer request-key')
  }
)

it.each([
  {
    model: 'anthropic/claude-sonnet-4-5',
    requestOptions: { thinking: { type: 'enabled', budget_tokens: 4096 } },
  },
  {
    model: 'google/gemini-2.5-pro',
    requestOptions: { generationConfig: { thinkingConfig: { thinkingBudget: 4096 } } },
  },
])('streams the installed $model native budget', async (fixture) => {
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => stream())
  vi.stubGlobal('fetch', fetcher)
  const work = await prepareModelRequest(
    { ...requestScope, model: fixture.model },
    { apiKey: 'request-key', reasoning: { type: 'budget_tokens', value: 4096 } }
  )
  await work.model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    providerOptions: work.options.providerOptions,
  })
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject(fixture.requestOptions)
})

const effort = (value: Extract<import('./reasoning').Reasoning, { type: 'effort' }>['value']) => ({
  type: 'effort' as const,
  value,
})
const budget = (value: number) => ({ type: 'budget_tokens' as const, value })
const toggle = (value: boolean) => ({ type: 'toggle' as const, value })
const nativeCases: [string, import('./reasoning').Reasoning, string, object][] = [
  ['openai/gpt-5', effort('high'), '/v1/responses', { reasoning: { effort: 'high' } }],
  [
    'openrouter/anthropic/claude-opus-4.6',
    effort('max'),
    '/chat/completions',
    { reasoning: { effort: 'max' } },
  ],
  ['cerebras/qwen-3.8-27b', effort('none'), '/chat/completions', { reasoning_effort: 'none' }],
  [
    'togetherai/reflection/Beam-1.0-501B-A23B',
    effort('minimal'),
    '/chat/completions',
    { reasoning_effort: 'minimal' },
  ],
  [
    'deepinfra/Qwen/Qwen3.8-2.4T-A95B',
    effort('xhigh'),
    '/chat/completions',
    { reasoning_effort: 'xhigh' },
  ],
  [
    'anthropic/claude-sonnet-4-6',
    effort('high'),
    '/v1/messages',
    { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } },
  ],
  [
    'anthropic/claude-opus-4-5',
    effort('high'),
    '/v1/messages',
    { output_config: { effort: 'high' } },
  ],
  [
    'anthropic/claude-haiku-4-5',
    budget(2048),
    '/v1/messages',
    { thinking: { type: 'enabled', budget_tokens: 2048 } },
  ],
  [
    'google/gemini-3-flash-preview',
    effort('minimal'),
    ':generateContent',
    { generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } },
  ],
  [
    'google/gemini-2.5-flash',
    budget(0),
    ':generateContent',
    { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } },
  ],
  [
    'google/gemini-2.5-flash',
    toggle(true),
    ':generateContent',
    { generationConfig: { thinkingConfig: { thinkingBudget: -1 } } },
  ],
  [
    'google/gemma-4-31b-it',
    toggle(false),
    ':generateContent',
    { generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } },
  ],
  [
    'openrouter/openai/gpt-5',
    effort('high'),
    '/chat/completions',
    { reasoning: { effort: 'high' } },
  ],
  [
    'openrouter/google/gemini-2.5-pro',
    budget(2048),
    '/chat/completions',
    { reasoning: { max_tokens: 2048 } },
  ],
  [
    'openrouter/amazon/nova-2-lite-v1',
    toggle(false),
    '/chat/completions',
    { reasoning: { enabled: false } },
  ],
  [
    'deepseek/deepseek-v4-pro',
    effort('max'),
    '/chat/completions',
    { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
  ],
  [
    'deepseek/deepseek-v4-pro',
    toggle(false),
    '/chat/completions',
    { thinking: { type: 'disabled' } },
  ],
  ['groq/openai/gpt-oss-120b', effort('low'), '/chat/completions', { reasoning_effort: 'low' }],
  ['mistral/mistral-large-4', effort('low'), '/chat/completions', { reasoning_effort: 'low' }],
  ['cerebras/gpt-oss-120b', effort('high'), '/chat/completions', { reasoning_effort: 'high' }],
  [
    'togetherai/openai/gpt-oss-120b',
    effort('low'),
    '/chat/completions',
    { reasoning_effort: 'low' },
  ],
  [
    'togetherai/MiniMaxAI/MiniMax-M3',
    toggle(true),
    '/chat/completions',
    { reasoning: { enabled: true } },
  ],
  [
    'deepinfra/openai/gpt-oss-120b',
    effort('low'),
    '/chat/completions',
    { reasoning_effort: 'low' },
  ],
  ['xai/grok-4.3', effort('medium'), '/v1/responses', { reasoning: { effort: 'medium' } }],
  [
    'alibaba/qwen-flash',
    budget(1024),
    '/chat/completions',
    { enable_thinking: true, thinking_budget: 1024 },
  ],
  ['alibaba/qwen-flash', toggle(false), '/chat/completions', { enable_thinking: false }],
  [
    'alibaba/qwen3.8-flash',
    effort('low'),
    '/chat/completions',
    { enable_thinking: true, thinking_budget: 1638 },
  ],
  [
    'perplexity/sonar-deep-research',
    effort('high'),
    '/v1/agent',
    { reasoning: { effort: 'high' } },
  ],
  [
    'fireworks-ai/accounts/fireworks/models/deepseek-v4p1-flash',
    effort('max'),
    '/chat/completions',
    { reasoning_effort: 'max' },
  ],
  [
    'moonshotai/kimi-k2.6',
    toggle(false),
    '/anthropic/v1/messages',
    { thinking: { type: 'disabled' } },
  ],
  [
    'vercel/openai/gpt-5',
    effort('low'),
    '/v3/ai/language-model',
    { providerOptions: { openai: { reasoningEffort: 'low' } } },
  ],
  ['sakana/fugu', effort('high'), '/responses', { reasoning: { effort: 'high' } }],
  ['meta/muse-ember-1.0', effort('high'), '/chat/completions', { reasoning_effort: 'high' }],
  ['zai/glm-4.5', toggle(false), '/chat/completions', { thinking: { type: 'disabled' } }],
  [
    'siliconflow/Qwen/Qwen3-14B',
    budget(2048),
    '/chat/completions',
    { enable_thinking: true, thinking_budget: 2048 },
  ],
]
it.each(nativeCases)(
  'serializes %s %j on the installed router',
  async (model, reasoning, endpoint, expected) => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ error: { message: 'end of capture' } }, { status: 400 })
    )
    vi.stubGlobal('fetch', fetcher)
    const work = await prepareModelRequest(
      { ...requestScope, model },
      { apiKey: 'fixture', reasoning }
    )
    const agent = new Agent({ id: 'wire', name: 'wire', instructions: '', model: work.model })
    await agent.generate('hello', work.options).catch(() => {})
    expect(fetcher).toHaveBeenCalled()
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toContain(endpoint)
    expect(JSON.parse(String(init?.body))).toMatchObject(expected)
  }
)
it.each([
  [undefined, 1024, 1024],
  [1024, 1024, 2048],
  [4096, 1024, 5120],
  [4096, 59_904, 64_000],
] as const)(
  'serializes Haiku thinking budget %s and answer allowance %i as max_tokens %i',
  async (thinkingBudget, maxOutputTokens, wireMaxTokens) => {
    const model = 'anthropic/claude-haiku-4-5'
    const scope = { ...requestScope, model }
    const capture = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        id: 'message_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    )
    vi.stubGlobal('fetch', capture)
    const work = await prepareModelRequest(scope, {
      apiKey: 'fixture',
      modelSettings: { maxOutputTokens },
      reasoning: thinkingBudget === undefined ? undefined : budget(thinkingBudget),
    })
    const agent = new Agent({ id: 'wire', name: 'wire', instructions: '', model: work.model })
    expect((await agent.generate('hello', work.options)).text).toBe('ok')
    expect(capture).toHaveBeenCalledTimes(1)
    const [url, init] = capture.mock.calls[0]!
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: wireMaxTokens })
    if (thinkingBudget === undefined) expect(body).not.toHaveProperty('thinking')
    else expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: thinkingBudget })
    expect(usageProcessors).toHaveBeenLastCalledWith(scope, expect.anything())
  }
)

it.each([
  ['mistral/mistral-large-4', effort('medium'), {}, false],
  ['alibaba/qwen-flash', budget(0), {}, false],
  ['google/gemini-2.5-flash', budget(1.5), {}, false],
  ['anthropic/claude-haiku-4-5', budget(4096), { maxOutputTokens: 59_905 }, false],
  ['anthropic/claude-haiku-4-5', budget(1024), {}, true],
  ['fireworks-ai/accounts/fireworks/models/deepseek-v4p1-flash', toggle(false), {}, false],
] as const)(
  'rejects non-requestable %s %j before accounting',
  async (model, reasoning, modelSettings, forceTool) => {
    vi.mocked(usageProcessors).mockClear()
    await expect(
      prepareModelRequest(
        { ...requestScope, model },
        { apiKey: 'fixture', reasoning, modelSettings, forceTool }
      )
    ).rejects.toThrow(/reasoning|thinking|Thinking/)
    expect(usageProcessors).not.toHaveBeenCalled()
  }
)

it.each([undefined, effort('high')])(
  'uses the same streaming path for default and explicit reasoning %j',
  async (reasoning) => {
    const capture = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => stream())
    vi.stubGlobal('fetch', capture)
    const work = await prepareModelRequest(
      { ...requestScope, model: 'openai/gpt-5' },
      { apiKey: 'fixture', reasoning }
    )
    const agent = new Agent({
      id: 'stream-wire',
      name: 'stream-wire',
      model: work.model,
      instructions: '',
    })
    const response = await agent.stream('hello', work.options)
    await response.getFullOutput().catch(() => {})
    const [url, init] = capture.mock.calls[0]!
    expect(String(url)).toContain('/responses')
    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    if (reasoning) expect(body.reasoning).toEqual({ effort: 'high' })
    else expect(body).not.toHaveProperty('reasoning')
  }
)
it('keeps a compatible named tool and adaptive effort together on the actual Anthropic request', async () => {
  const capture = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => stream())
  vi.stubGlobal('fetch', capture)
  const work = await prepareModelRequest(
    { ...requestScope, model: 'anthropic/claude-sonnet-4-6' },
    { apiKey: 'fixture', reasoning: effort('high'), forceTool: true }
  )
  await work.model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    providerOptions: work.options.providerOptions,
    tools: [{ type: 'function', name: 'observe', inputSchema: { type: 'object' } }],
    toolChoice: { type: 'tool', toolName: 'observe' },
  })
  expect(JSON.parse(String(capture.mock.calls[0]![1]?.body))).toMatchObject({
    tool_choice: { type: 'tool', name: 'observe' },
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  })
})
