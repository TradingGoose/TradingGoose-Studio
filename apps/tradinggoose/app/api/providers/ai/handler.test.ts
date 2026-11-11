vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: (id: string, apiKey?: string) => ({ id, apiKey }),
}))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: async (scope: unknown) => {
    native.finance(scope)
    return {
      inputProcessors: [],
      outputProcessors: [],
      getUsage: () => native.usage(),
      getCost: () => native.cost(),
      verifyComplete: async () => {},
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { EMBEDDING_MODELS } from '@mastra/core/llm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withInferenceFacts } from '@/lib/mastra/result'
import { handleAIProviderRequest } from './handler'

const native = vi.hoisted(() => ({
  finance: vi.fn(),
  cost: vi.fn(),
  generate: vi.fn(),
  stream: vi.fn(),
  configurations: [] as any[],
  executeTool: vi.fn(),
  usage: vi.fn(),
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(configuration: any) {
      native.configurations.push(configuration)
    }
    generate = native.generate
    stream = native.stream
  },
}))
vi.mock('@/blocks', () => ({ getAllBlocks: vi.fn(() => []) }))
vi.mock('@/tools', () => ({ executeTool: native.executeTool, getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
const result = {
  text: '价格 📈',
  finishReason: 'stop',
  totalUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  steps: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  native.cost.mockReset().mockReturnValue({ status: 'unavailable' })
  native.usage.mockReset().mockReturnValue(result.totalUsage)
  native.configurations.length = 0
  native.generate.mockResolvedValue(result)
  native.executeTool.mockResolvedValue({ success: true, output: { found: true } })
})
describe('native AI HTTP handler', () => {
  it('requires and exactly validates the resolved canonical model', async () => {
    const missing = await handleAIProviderRequest({ body: {}, requestId: 'missing' })
    expect(missing.status).toBe(400)
    await expect(
      handleAIProviderRequest({ body: { model: 'gpt-4.1' }, requestId: 'bare' })
    ).rejects.toThrow()
    expect(native.generate).not.toHaveBeenCalled()
  })
  it('passes canonical Anthropic routing and request-local keys directly to Mastra', async () => {
    const cost = { total: 0.005, currency: 'USD', status: 'estimated' }
    native.cost.mockReturnValue(cost)
    const response = await handleAIProviderRequest({
      body: {
        model: 'anthropic/claude-sonnet-4-5',
        apiKey: 'tenant-key',
        messages: [{ role: 'user', content: 'Analyze' }],
        modelSettings: { maxOutputTokens: 51 },
      },
      requestId: 'anthropic',
    })
    expect(native.configurations[0].model).toEqual({
      id: 'anthropic/claude-sonnet-4-5',
      apiKey: 'tenant-key',
    })
    expect(native.generate.mock.calls[0][1].modelSettings.maxOutputTokens).toBe(51)
    expect(await response.json()).toMatchObject({
      content: '价格 📈',
      tokens: { total: 5 },
      cost,
    })
  })
  it('binds tool authorization to the authenticated actor and preserves configured arguments', async () => {
    await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        workspaceId: 'workspace',
        workflowId: 'workflow',
        tools: [
          {
            id: 'lookup',
            description: 'Lookup',
            params: { query: 'fixed' },
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      },
      requestId: 'tools',
      authUserId: 'authenticated-user',
    })
    await native.configurations[0].tools.lookup.execute({ query: 'generated' }, {})
    expect(native.executeTool.mock.calls[0][1]).toMatchObject({
      query: 'fixed',
      _context: { userId: 'authenticated-user', workspaceId: 'workspace', workflowId: 'workflow' },
    })
  })
  it('transports native Unicode events and completes workflow metadata after stream consumption', async () => {
    native.stream.mockResolvedValue({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', payload: { text: '价格 📈' } })
          controller.close()
        },
      }),
      getFullOutput: async () => result,
    })
    const response = await handleAIProviderRequest({
      body: { model: 'openai/gpt-4.1', stream: true },
      requestId: 'stream',
    })
    const text = await response.text()
    expect(text).toContain('价格 📈')
    expect(text).toContain('"type":"workflow-output"')
    expect(text).toContain('"total":5')
    expect(text).toContain('"status":"unavailable"')
  })
})

it('retains completed tool charges when HTTP native generation fails later', async () => {
  native.executeTool.mockResolvedValue({
    success: true,
    output: withInferenceFacts(
      { found: true, cost: { availableTotal: 0.006, status: 'partial' } },
      { cost: { availableTotal: 0.006, status: 'partial' }, generatedFields: ['cost'] }
    ),
  })
  native.generate.mockImplementationOnce(async () => {
    await native.configurations[0].tools.lookup.execute({ query: 'generated' }, {})
    throw new Error('Later native model failure')
  })
  await expect(
    handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        tools: [
          {
            id: 'lookup',
            description: 'Lookup',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      },
      requestId: 'failed-tool',
      authUserId: 'actor',
    })
  ).rejects.toMatchObject({
    toolCost: 0.006,
    unavailableToolCosts: 1,
    cost: { status: 'unavailable' },
  })
})

it.each([false, true])(
  'keeps raw business reports functional without counting them after HTTP failure (stream=%s)',
  async (stream) => {
    const business = {
      id: 'business-id',
      model: 'business-model',
      tokens: { total: 9999 },
      cost: { availableTotal: 9999, status: 'partial' },
      inference: { tokens: { total: 9999 }, cost: { total: 9999 } },
    }
    native.executeTool.mockResolvedValue({ success: true, output: business })
    const failure = new Error('Later untrusted business fixture failure')
    const execute = async () => {
      await native.configurations[0].tools.lookup.execute({ query: 'generated' }, {})
    }
    if (stream)
      native.stream.mockImplementationOnce(async () => {
        await execute()
        return {
          fullStream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'error', payload: { error: failure } })
              controller.close()
            },
          }),
          getFullOutput: async () => {
            throw failure
          },
        }
      })
    else
      native.generate.mockImplementationOnce(async () => {
        await execute()
        throw failure
      })
    const request = handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        stream,
        tools: [
          {
            id: 'lookup',
            description: 'Lookup',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      },
      requestId: `business-failure-${stream}`,
      authUserId: 'actor',
    })
    if (stream) {
      const reader = (await request).body!.getReader()
      expect((await reader.read()).done).toBe(false)
      await expect(reader.read()).rejects.toBe(failure)
    } else await expect(request).rejects.toBe(failure)
    expect(failure).toMatchObject({ toolResults: [business] })
    expect(failure).not.toHaveProperty('toolCost')
    expect(failure).not.toHaveProperty('unavailableToolCosts')
    expect(business.tokens.total).toBe(9999)
    expect(business.cost.availableTotal).toBe(9999)
    expect(native.executeTool).toHaveBeenCalledTimes(1)
  }
)

describe('public native stream errors and lifecycle', () => {
  it.each(['error', 'tool-error'] as const)(
    'projects %s without SDK diagnostic payloads',
    async (type) => {
      const apiKey = 'fixture-caller-credential'
      const error = Object.assign(new Error(`Provider failed for ${apiKey}`), {
        responseHeaders: { 'x-private': 'private-header' },
        responseBody: 'private-body',
        requestBodyValues: { privateRequest: 'private-request' },
      })
      native.stream.mockResolvedValue({
        fullStream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type,
              payload: {
                error,
                toolName: 'lookup',
                toolCallId: 'lookup-call',
                args: { apiKey },
                providerMetadata: { diagnostic: 'private-metadata' },
              },
            })
            controller.close()
          },
        }),
        getFullOutput: async () => result,
      })
      const response = await handleAIProviderRequest({
        body: { model: 'openai/gpt-4.1', apiKey, stream: true },
        requestId: `public-${type}`,
      })
      const text = await response.text()
      const event = JSON.parse(text.split('\n\n')[0].slice(6))
      expect(event).toEqual({
        type,
        payload: {
          ...(type === 'tool-error' ? { toolName: 'lookup', toolCallId: 'lookup-call' } : {}),
          error: 'Provider failed for [redacted]',
        },
      })
      expect(text).not.toMatch(/responseHeaders|responseBody|requestBodyValues|stack|private-/)
      expect(text).not.toContain(apiKey)
    }
  )

  it('uses the existing generic public message for serialized native errors', async () => {
    native.stream.mockResolvedValue({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'error',
            payload: {
              error: {
                message: 'private-upstream-message',
                stack: 'private-stack',
                responseBody: 'private-body',
              },
            },
          })
          controller.close()
        },
      }),
      getFullOutput: async () => result,
    })
    const response = await handleAIProviderRequest({
      body: { model: 'openai/gpt-4.1', stream: true },
      requestId: 'serialized-error',
    })
    const text = await response.text()
    expect(text).toContain('Model request failed. Check the selected model and connection.')
    expect(text).not.toMatch(/private-|responseBody|stack/)
  })

  it('retains completed-step and tool accounting after a later stream failure', async () => {
    native.executeTool.mockResolvedValue({
      success: true,
      output: withInferenceFacts(
        { cost: { availableTotal: 0.006, status: 'partial' } },
        { cost: { availableTotal: 0.006, status: 'partial' }, generatedFields: ['cost'] }
      ),
    })
    const error = new Error('Later native stream failure')
    native.stream.mockImplementationOnce(async () => {
      await native.configurations[0].tools.lookup.execute({ query: 'generated' }, {})
      return {
        fullStream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'error', payload: { error } })
            controller.close()
          },
        }),
        getFullOutput: async () => {
          throw error
        },
      }
    })
    const response = await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        stream: true,
        tools: [
          {
            id: 'lookup',
            description: 'Lookup',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      },
      requestId: 'stream-accounting',
    })
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('Later native stream failure')
    await expect(reader.read()).rejects.toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { total: 5 },
      cost: { status: 'unavailable' },
      toolCost: 0.006,
      unavailableToolCosts: 1,
    })
    expect(native.usage).toHaveBeenCalled()
  })

  it('aborts native work and captures completed usage when the HTTP reader cancels', async () => {
    const cancel = vi.fn()
    let signal: AbortSignal | undefined
    native.stream.mockImplementationOnce(async (_messages, options) => {
      signal = options.abortSignal
      return {
        fullStream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-delta', payload: { text: 'Partial' } })
          },
          cancel,
        }),
      }
    })
    const response = await handleAIProviderRequest({
      body: { model: 'openai/gpt-4.1', stream: true },
      requestId: 'stream-cancel',
    })
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel('Consumer stopped')
    expect(signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledWith('Consumer stopped')
    expect(native.usage).toHaveBeenCalled()
  })
})

it.each(EMBEDDING_MODELS.map(({ provider, id }) => [`${provider}/${id}`, provider, id] as const))(
  'refuses native-known embedding model %s before generation admission or model contact',
  async (model, provider, modelId) => {
    // Trusted deployment membership is explicit; purpose rejection uses real installed native metadata.
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        [provider]: {
          name: 'Controlled registered provider',
          url: 'https://not-contacted.invalid',
          models: [modelId],
        },
      })
    )
    try {
      await expect(
        handleAIProviderRequest({
          body: { model, messages: [{ role: 'user', content: 'Generate a response' }] },
          requestId: 'embedding-rejected',
          authUserId: 'user-1',
        })
      ).rejects.toMatchObject({ status: 400 })
      expect(native.finance).not.toHaveBeenCalled()
      expect(native.generate).not.toHaveBeenCalled()
      expect(native.stream).not.toHaveBeenCalled()
      expect(native.configurations).toEqual([])
      expect(native.executeTool).not.toHaveBeenCalled()
      expect(native.usage).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  }
)
