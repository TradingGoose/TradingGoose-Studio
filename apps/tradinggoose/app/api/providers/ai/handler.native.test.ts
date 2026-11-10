vi.mock('@/lib/mastra/financial-processors', () => ({
  financialProcessors: async (scope: unknown) => {
    media.finance(scope)
    const signal = (scope as { signal: AbortSignal }).signal
    let occurrence: { stepNumber: number; retryCount: number; runId?: string } | undefined
    const completed = new Map<string, { usage: any }>()
    return {
      inputProcessors: media.trackAdmissions
        ? [
            {
              id: 'fixture-live-provider-admission',
              processInputStep: (args: {
                stepNumber: number
                retryCount: number
                runId?: string
              }) => {
                signal.throwIfAborted()
                occurrence = {
                  stepNumber: args.stepNumber,
                  retryCount: args.retryCount,
                  runId: args.runId,
                }
                media.admissions(args.stepNumber)
              },
            },
          ]
        : [],
      outputProcessors: media.trackAdmissions
        ? [
            {
              id: 'fixture-live-provider-completed-usage',
              processOutputStep: (args: any) => {
                if (!occurrence) throw new Error('Fixture response has no admitted occurrence')
                const key = JSON.stringify(occurrence)
                completed.set(key, {
                  usage: { ...selectNativeUsage(args.usage), ...completed.get(key)?.usage },
                })
              },
            },
          ]
        : [],
      getUsage: () => sumNativeUsage([...completed.values()]),
      verifyComplete: async () => {
        if (media.trackAdmissions) signal.throwIfAborted()
      },
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { withInferenceFacts } from '@/lib/mastra/result'
import { selectNativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { executeTool } from '@/tools'
import { handleAIProviderRequest } from './handler'

const media = vi.hoisted(() => ({
  model: undefined as unknown,
  finance: vi.fn(),
  trackAdmissions: false,
  admissions: vi.fn(),
}))
vi.mock('@/lib/mastra/connections', async (original) => {
  const actual = await original<typeof import('@/lib/mastra/connections')>()
  return {
    ...actual,
    createConfiguredLanguageModel: (
      ...args: Parameters<typeof actual.createConfiguredLanguageModel>
    ) => media.model ?? actual.createConfiguredLanguageModel(...args),
  }
})

vi.mock('@/lib/mastra/usage', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/usage')>()),
  getMastra: async () => undefined,
}))
vi.mock('@/blocks', () => ({ getAllBlocks: vi.fn(() => []) }))
vi.mock('@/tools', () => ({ executeTool: vi.fn(), getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

beforeEach(() => {
  media.model = undefined
  media.finance.mockClear()
  media.trackAdmissions = false
  media.admissions.mockClear()
  vi.mocked(executeTool).mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it.each([401, 429, 500])(
  'keeps installed native adapter diagnostics out of public HTTP %s errors with one contact',
  async (status) => {
    const credential = 'fixture-upstream-private-credential'
    const privateRequest = 'fixture-private-request-value'
    vi.stubEnv('OPENAI_API_KEY', credential)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: {
            message: 'Upstream rejected the request',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
          privateDiagnostic: credential,
        },
        { status, headers: { 'x-upstream-private': credential } }
      )
    )
    vi.stubGlobal('fetch', fetcher)

    const response = await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        messages: [{ role: 'user', content: privateRequest }],
        stream: true,
        modelSettings: { maxRetries: 0 },
      },
      requestId: 'installed-adapter-error',
    })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let failure: unknown
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        text += decoder.decode(chunk.value, { stream: true })
      }
    } catch (error) {
      failure = error
    }

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(request.headers).get('authorization')).toBe(`Bearer ${credential}`)
    expect(request.body).toContain(privateRequest)
    const events = text
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)))
    expect(events).toContainEqual({
      type: 'error',
      payload: { error: 'Upstream rejected the request' },
    })
    expect(text).not.toMatch(/responseHeaders|responseBody|requestBodyValues|stack/)
    expect(text).not.toContain(credential)
    expect(JSON.stringify(events.find((event) => event.type === 'error'))).not.toContain(
      privateRequest
    )
    expect(text).not.toContain('workflow-output')
    expect(failure).toMatchObject({
      model: 'openai/gpt-4.1',
      cost: { status: 'unavailable' },
    })
  }
)

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6uO8AAAAASUVORK5CYII=',
  'base64'
)
const nativeUsage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
function nativeMediaModel(supported = false) {
  const model = new MastraLanguageModelV2Mock({
    supportedUrls: supported ? { 'image/*': [/^https:\/\//] } : {},
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'native media answer' }],
      finishReason: 'stop',
      usage: nativeUsage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'media' })
          controller.enqueue({ type: 'text-delta', id: 'media', delta: 'native media answer' })
          controller.enqueue({ type: 'text-end', id: 'media' })
          controller.enqueue({ type: 'finish', finishReason: 'stop', usage: nativeUsage })
          controller.close()
        },
      }),
    }),
  })
  media.model = model
  return model
}

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'installed native generate/stream sees bytes for user and assistant/tool URLs (stream=%s,supported=%s)',
  async (stream, supported) => {
    const model = nativeMediaModel(supported)
    const urls = [
      'https://public.fixture/user.png',
      'https://public.fixture/assistant.png',
      'https://public.fixture/tool.png',
    ]
    const inline = `data:image/png;base64,${png.toString('base64')}`
    const inlineDecode = vi.fn()
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === inline) inlineDecode()
      else expect(urls).toContain(String(url))
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        apiKey: 'request-local-media-key',
        stream,
        tools: [
          { id: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: {} } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'literal before' },
              { type: 'image', image: urls[0] },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool-call', toolCallId: 'a', toolName: 'inspect', input: {} },
              {
                type: 'tool-result',
                toolCallId: 'a',
                toolName: 'inspect',
                output: { type: 'content', value: [{ type: 'image-url', url: urls[1] }] },
              },
              { type: 'tool-call', toolCallId: 'b', toolName: 'inspect', input: {} },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'b',
                toolName: 'inspect',
                output: {
                  type: 'content',
                  value: [{ type: 'file-url', url: urls[2], mediaType: 'image/png' }],
                },
              },
            ],
          },
        ],
      },
      requestId: 'native-media',
      authUserId: 'actual-requester',
    })
    expect(await response.text()).toContain('native media answer')
    expect(
      fetcher.mock.calls.filter(([url]) => String(url) !== inline).map(([url]) => String(url))
    ).toEqual(urls)
    expect(inlineDecode).toHaveBeenCalledTimes(1)
    for (const [, init] of fetcher.mock.calls.filter(
      ([url]) => String(url) !== inline
    ) as unknown as Array<[string, RequestInit]>) {
      expect(init.headers).toBeUndefined()
      expect(init.redirect).toBe('manual')
    }
    const calls = stream ? model.doStreamCalls : model.doGenerateCalls
    expect(calls).toHaveLength(1)
    const prompt = JSON.stringify(calls[0].prompt)
    for (const url of urls) expect(prompt).not.toContain(url)
    expect(prompt).toContain('literal before')
    expect(media.finance).toHaveBeenCalledTimes(1)
  }
)

it.each(['ui', 'db', 'v4', 'db-nested', 'db-data'])(
  'installed native converts the already guarded %s inline form with no original HTTP refetch',
  async (format) => {
    const model = nativeMediaModel()
    const url = `https://public.fixture/${format}.png`
    const inline = `data:image/png;base64,${png.toString('base64')}`
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === url)
        return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
      // Selected native UI conversion may decode this verified local inline representation.
      // This seam permits only the EXACT application-produced bytes, never an external fallback.
      expect(String(input)).toBe(inline)
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const file = { type: 'file', url, mediaType: 'image/png', filename: 'image.png' }
    const message: any =
      format === 'ui'
        ? { id: 'ui', role: 'user', parts: [file] }
        : format === 'db' || format === 'db-data'
          ? {
              id: 'db',
              role: 'user',
              createdAt: new Date(),
              content: {
                format: 2,
                parts: [
                  format === 'db-data' ? { type: 'file', data: url, mimeType: 'image/png' } : file,
                ],
              },
            }
          : format === 'db-nested'
            ? {
                id: 'db-nested',
                role: 'user',
                createdAt: new Date(),
                content: {
                  format: 2,
                  parts: [{ type: 'text', text: 'attachment' }],
                  experimental_attachments: [{ name: 'image.png', url, contentType: 'image/png' }],
                },
              }
            : {
                id: 'v4',
                role: 'user',
                content: 'attachment',
                experimental_attachments: [{ name: 'image.png', url, contentType: 'image/png' }],
              }
    const response = await handleAIProviderRequest({
      body: { model: 'openai/gpt-4.1', messages: [message] },
      requestId: `inline-${format}`,
      authUserId: 'requester',
    })
    expect(await response.text()).toContain('native media answer')
    expect(fetcher.mock.calls.filter(([input]) => String(input) === url)).toHaveLength(1)
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).not.toContain(url)
  }
)

it.each([false, true])(
  'refuses protected native media before financial/model/fetch (stream=%s)',
  async (stream) => {
    const model = nativeMediaModel(true)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      handleAIProviderRequest({
        body: {
          model: 'openai/gpt-4.1',
          stream,
          messages: [
            {
              role: 'user',
              content: [{ type: 'image', image: '/api/files/serve/flat.png?context=copilot' }],
            },
          ],
        },
        requestId: 'private-media',
        authUserId: 'requester',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(fetcher).not.toHaveBeenCalled()
    expect(media.finance).not.toHaveBeenCalled()
    expect(model.doGenerateCalls).toHaveLength(0)
    expect(model.doStreamCalls).toHaveLength(0)
  }
)

function toolSemanticMessage(format: string, url: string): any {
  const modelOutput = { type: 'content', value: [{ type: 'image-url', url }] }
  const metadata = { fixture: { signature: 'retained' }, mastra: { modelOutput } }
  const result = { content: [{ type: 'image', data: url, mimeType: 'image/png' }] }
  if (format === 'db-metadata')
    return {
      id: 'db-metadata',
      role: 'assistant',
      createdAt: new Date(),
      content: {
        format: 2,
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'stored',
              toolName: 'inspect',
              args: {},
              result: 'literal result',
            },
            providerMetadata: metadata,
          },
        ],
      },
    }
  if (format === 'ui-result-metadata' || format === 'ui-call-metadata')
    return {
      id: format,
      role: 'assistant',
      parts: [
        {
          type: 'tool-inspect',
          state: 'output-available',
          toolCallId: 'stored',
          input: {},
          output: 'literal result',
          [format === 'ui-result-metadata' ? 'resultProviderMetadata' : 'callProviderMetadata']:
            metadata,
        },
      ],
    }
  if (format === 'core-metadata')
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'stored',
          toolName: 'inspect',
          output: { type: 'json', value: 'literal result' },
          providerOptions: metadata,
        },
      ],
    }
  if (format === 'v5-media')
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'stored',
          toolName: 'inspect',
          output: {
            type: 'content',
            value: [{ type: 'media', data: url, mediaType: 'image/png' }],
          },
        },
      ],
    }
  if (format === 'db-mcp')
    return {
      id: 'db-mcp',
      role: 'assistant',
      createdAt: new Date(),
      content: {
        format: 2,
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'stored',
              toolName: 'inspect',
              args: {},
              result,
            },
          },
        ],
      },
    }
  if (format === 'db-invocations')
    return {
      id: 'db-invocations',
      role: 'assistant',
      createdAt: new Date(),
      content: {
        format: 2,
        parts: [],
        toolInvocations: [
          { state: 'result', toolCallId: 'stored', toolName: 'inspect', args: {}, result },
        ],
      },
    }
  if (format === 'v4-mcp')
    return {
      id: 'v4-mcp',
      role: 'assistant',
      parts: [],
      content: '',
      toolInvocations: [
        { state: 'result', toolCallId: 'stored', toolName: 'inspect', args: {}, result },
      ],
    }
  return {
    id: 'ui-mcp',
    role: 'assistant',
    parts: [
      {
        type: 'tool-inspect',
        state: 'output-available',
        toolCallId: 'stored',
        input: {},
        output: result,
      },
    ],
  }
}
const semanticFormats = [
  'db-metadata',
  'ui-result-metadata',
  'ui-call-metadata',
  'core-metadata',
  'v5-media',
  'db-mcp',
  'db-invocations',
  'ui-mcp',
  'v4-mcp',
]
it.each(semanticFormats)(
  'installed native receives guarded %s media without original URL refetch',
  async (format) => {
    const model = nativeMediaModel(true)
    const url = `https://public.fixture/${format}.png`
    const inline = `data:image/png;base64,${png.toString('base64')}`
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === url) expect(init?.redirect).toBe('manual')
      else expect(String(input)).toBe(inline)
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const messages: any[] = []
    if (format === 'core-metadata' || format === 'v5-media')
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'stored', toolName: 'inspect', input: {} }],
      })
    messages.push(toolSemanticMessage(format, url), {
      role: 'user',
      content: 'Use the supplied result.',
    })
    const response = await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        tools: [
          { id: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: {} } },
        ],
        messages,
      },
      requestId: `semantic-${format}`,
      authUserId: 'requester',
    })
    expect(await response.text()).toContain('native media answer')
    expect(fetcher.mock.calls.filter(([input]) => String(input) === url)).toHaveLength(1)
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).not.toContain(url)
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain(png.toString('base64'))
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('image/png')
    expect(media.finance).toHaveBeenCalledTimes(1)
  }
)
it.each(semanticFormats.flatMap((format) => [false, true].map((stream) => ({ format, stream }))))(
  'refuses protected $format before installed native/financial contact (stream=$stream)',
  async ({ format, stream }) => {
    const model = nativeMediaModel(true)
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      handleAIProviderRequest({
        body: {
          model: 'openai/gpt-4.1',
          stream,
          messages: [
            toolSemanticMessage(
              format,
              'https://private.fixture/api/files/serve/raw.png?context=copilot'
            ),
            { role: 'user', content: 'Continue.' },
          ],
        },
        requestId: 'protected-semantic',
        authUserId: 'requester',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(fetcher).not.toHaveBeenCalled()
    expect(media.finance).not.toHaveBeenCalled()
    expect(model.doGenerateCalls).toHaveLength(0)
    expect(model.doStreamCalls).toHaveLength(0)
  }
)

function liveProviderToolModel() {
  const first = (options: { toolChoice?: { type: string } }) => options.toolChoice?.type === 'tool'
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async (options) => ({
      content: first(options)
        ? [
            { type: 'text' as const, text: 'Known provider reply before media' },
            {
              type: 'tool-call' as const,
              toolCallId: 'live-inspect',
              toolName: 'inspect',
              input: '{}',
            },
          ]
        : [{ type: 'text' as const, text: 'Verified provider media answer' }],
      finishReason: first(options) ? 'tool-calls' : 'stop',
      usage: nativeUsage,
      warnings: [],
    }),
    doStream: async (options) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'live-provider-text' })
          controller.enqueue({
            type: 'text-delta',
            id: 'live-provider-text',
            delta: first(options)
              ? 'Known provider reply before media'
              : 'Verified provider media answer',
          })
          controller.enqueue({ type: 'text-end', id: 'live-provider-text' })
          if (first(options))
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'live-inspect',
              toolName: 'inspect',
              input: '{}',
            })
          controller.enqueue({
            type: 'finish',
            finishReason: first(options) ? 'tool-calls' : 'stop',
            usage: nativeUsage,
          })
          controller.close()
        },
      }),
    }),
  })
  media.model = model
  return model
}

it.each([false, true].flatMap((stream) => [false, true].map((allowed) => ({ stream, allowed }))))(
  'guards a newly returned provider tool before the next installed native step (stream=$stream,allowed=$allowed)',
  async ({ stream, allowed }) => {
    const model = liveProviderToolModel()
    media.trackAdmissions = true
    const url = allowed
      ? 'https://public.fixture/live-provider.png'
      : 'https://private.fixture/api/files/serve/hidden.png?context=copilot'
    const toolFacts = {
      tokens: { total: 9 },
      cost: { total: 0.004, status: 'reported' as const },
      generatedFields: ['tokens', 'cost'],
    }
    const raw = withInferenceFacts(
      {
        content: [
          { type: 'text', text: 'Exact provider tool text' },
          { type: 'image', data: url, mimeType: 'image/png' },
        ],
        business: { value: 23 },
        tokens: toolFacts.tokens,
        cost: toolFacts.cost,
      },
      toolFacts
    )
    vi.mocked(executeTool).mockResolvedValue({ success: true, output: raw })
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://public.fixture/live-provider.png')
      expect(init?.redirect).toBe('manual')
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetcher)
    let output: any
    let failure: unknown
    let visible = ''
    try {
      const response = await handleAIProviderRequest({
        body: {
          model: 'openai/gpt-4.1',
          stream,
          workspaceId: 'trusted-workspace',
          messages: [{ role: 'user', content: 'Inspect one actual tool result' }],
          tools: [
            {
              id: 'inspect',
              description: 'Inspect',
              parameters: { type: 'object', properties: {} },
              usageControl: 'force',
            },
          ],
        },
        requestId: 'live-tool-provider',
        authUserId: 'trusted-requester',
      })
      if (stream) {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          visible += decoder.decode(chunk.value, { stream: true })
        }
        const event = visible
          .split('\n\n')
          .filter((value) => value.startsWith('data: '))
          .map((value) => JSON.parse(value.slice(6)))
          .find((value) => value.type === 'workflow-output')
        output = event?.output
      } else output = await response.json()
    } catch (error) {
      failure = error
    }
    const calls = stream ? model.doStreamCalls : model.doGenerateCalls
    expect(executeTool).toHaveBeenCalledOnce()
    expect(vi.mocked(executeTool).mock.calls[0][1]).toMatchObject({
      _context: { userId: 'trusted-requester', workspaceId: 'trusted-workspace' },
    })
    expect(media.finance).toHaveBeenCalledOnce()
    expect(media.admissions).toHaveBeenCalledTimes(allowed ? 2 : 1)
    expect(calls).toHaveLength(allowed ? 2 : 1)
    const scope = media.finance.mock.calls[0][0] as { signal: AbortSignal }
    expect(scope.signal.aborted).toBe(!allowed)
    expect(fetcher).toHaveBeenCalledTimes(allowed ? 1 : 0)
    expect(raw.content[1].data).toBe(url)
    const active = allowed ? output : failure
    expect(active).toMatchObject({
      model: 'openai/gpt-4.1',
      toolCost: 0.004,
      tokens: { prompt: allowed ? 4 : 2, completion: allowed ? 6 : 3, total: allowed ? 10 : 5 },
      toolResults: [
        {
          content: raw.content,
          business: raw.business,
          tokens: toolFacts.tokens,
          cost: toolFacts.cost,
        },
      ],
    })
    if (allowed) {
      expect(failure).toBeUndefined()
      expect(output.content).toBe('Known provider reply before mediaVerified provider media answer')
      const prompt = JSON.stringify(calls[1].prompt)
      expect(prompt).not.toContain(url)
      expect(prompt).toContain(png.toString('base64'))
      expect(prompt).toContain('Exact provider tool text')
      expect(prompt).not.toContain('"total":9')
    } else {
      expect(failure).toBeInstanceOf(Error)
      if (stream) expect(visible).toContain('Known provider reply before media')
    }
  }
)

it('preserves a nested provider business wrapper without promoting or fetching its image-shaped JSON', async () => {
  const model = liveProviderToolModel()
  media.trackAdmissions = true
  const url = 'https://private.fixture/api/files/serve/business.png?context=copilot'
  const raw = {
    success: true,
    output: { content: [{ type: 'image', data: url, mimeType: 'image/png' }] },
    literal: 'unchanged',
  }
  vi.mocked(executeTool).mockResolvedValue({ success: true, output: raw })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const response = await handleAIProviderRequest({
    body: {
      model: 'openai/gpt-4.1',
      workspaceId: 'trusted-workspace',
      messages: [{ role: 'user', content: 'Use literal data' }],
      tools: [
        {
          id: 'inspect',
          description: 'Inspect',
          parameters: { type: 'object', properties: {} },
          usageControl: 'force',
        },
      ],
    },
    requestId: 'literal-business-provider',
    authUserId: 'trusted-requester',
  })
  const output = await response.json()
  expect(output.content).toBe('Known provider reply before mediaVerified provider media answer')
  expect(output.toolResults[0]).toMatchObject(raw)
  expect(media.admissions).toHaveBeenCalledTimes(2)
  expect(model.doGenerateCalls).toHaveLength(2)
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(url)
  expect(executeTool).toHaveBeenCalledOnce()
  expect(fetcher).not.toHaveBeenCalled()
})
