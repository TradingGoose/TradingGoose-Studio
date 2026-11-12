vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: async (scope: unknown) => {
    native.finance(scope)
    return {
      inputProcessors: [],
      outputProcessors: [],
      getUsage: () => native.usage(),
      getCost: () => native.cost(),
      verifyComplete: () => native.verify(),
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { EMBEDDING_MODELS } from '@mastra/core/llm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getInferenceFacts } from '@/lib/mastra/result'
import { EvaluatorBlockHandler } from './evaluator-handler'

const native = vi.hoisted(() => ({
  realAgent: false,
  finance: vi.fn(),
  cost: vi.fn(),
  generate: vi.fn(),
  usage: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('@mastra/core/agent', async (original) => {
  const actual = await original<typeof import('@mastra/core/agent')>()
  return {
    ...actual,
    Agent: class extends actual.Agent {
      generate(messages: any, options?: any): any {
        return native.realAgent
          ? super.generate(messages, options)
          : native.generate(messages, options)
      }
    },
  }
})
const block = { id: 'evaluator', metadata: { id: 'evaluator' } } as any
const context = { workspaceId: 'workspace', userId: 'user' } as any
beforeEach(() => {
  vi.clearAllMocks()
  native.realAgent = false
  native.cost.mockReset().mockReturnValue({ status: 'unavailable' })
  native.usage.mockReset().mockReturnValue({ totalTokens: 7 })
  native.verify.mockReset().mockResolvedValue(undefined)
  native.generate.mockResolvedValue({
    finishReason: 'stop',
    object: { accuracy: 8 },
    totalUsage: { totalTokens: 7 },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('Evaluator native structured generation', () => {
  it.each([
    [{ accuracy: 8 }, true],
    [{}, false],
    [{ accuracy: '8' }, false],
    [{ accuracy: 11 }, false],
    [{ accuracy: 8, extra: 1 }, false],
  ] as const)(
    'validates %j through the actual Groq adapter without requiring native structured output',
    async (object, valid) => {
      native.realAgent = true
      vi.stubEnv('MASTRA_MODEL_PROVIDERS', '{}')
      vi.stubEnv('MASTRA_AZURE_OPENAI', '')
      const requests: Record<string, any>[] = []
      const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions')
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        if (body.response_format?.type === 'json_schema')
          return Response.json(
            { error: { message: 'Native JSON schemas are unsupported by this model' } },
            { status: 400 }
          )
        return Response.json({
          id: 'chatcmpl_evaluator',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(object) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
        })
      })
      vi.stubGlobal('fetch', fetcher)
      const execution = new EvaluatorBlockHandler().execute(
        block,
        {
          model: 'groq/llama-3.3-70b-versatile',
          apiKey: 'fixture-key',
          content: 'Evaluate this answer',
          metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
        },
        context
      )
      if (valid) await expect(execution).resolves.toMatchObject({ accuracy: 8 })
      else await expect(execution).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(requests[0].model).toBe('llama-3.3-70b-versatile')
      expect(requests[0]).not.toHaveProperty('response_format')
      expect(JSON.stringify(requests[0].messages)).toContain('JSON schema:')
    }
  )
  it('retains metric output references and configures actual metric bounds', async () => {
    const cost = {
      input: 0.002,
      output: 0.003,
      total: 0.005,
      currency: 'USD',
      estimated: true,
      status: 'estimated',
    }
    native.cost.mockReturnValue(cost)
    const output = await new EvaluatorBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        content: { answer: 42 },
        temperature: 0,
        metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 }, description: 'Accurate answer' }],
      },
      context
    )
    expect(output).toMatchObject({
      accuracy: 8,
      content: { answer: 42 },
      tokens: { total: 7 },
      cost,
    })
    expect(native.generate.mock.calls[0][0]).toEqual([{ role: 'user', content: '{"answer":42}' }])
    expect(native.generate.mock.calls[0][1].structuredOutput.errorStrategy).toBe('strict')
    expect(native.generate.mock.calls[0][1].modelSettings.temperature).toBe(0)
  })
  it('propagates native schema failures instead of synthesizing zero scores', async () => {
    native.generate.mockRejectedValue(new Error('Schema validation failed'))
    await expect(
      new EvaluatorBlockHandler().execute(block, { model: 'openai/gpt-4.1', metrics: [] }, context)
    ).rejects.toThrow('Schema validation failed')
  })
  it('rejects unlisted resolved models before inference', async () => {
    await expect(
      new EvaluatorBlockHandler().execute(block, { model: 'gpt-4o' }, context)
    ).rejects.toThrow()
    expect(native.generate).not.toHaveBeenCalled()
  })
})

describe('evaluator incomplete native outcomes and workflow cancellation', () => {
  it.each(['aborted', 'error'])(
    'rejects %s results and retains completed accounting',
    async (finishReason) => {
      native.generate.mockResolvedValue({
        finishReason,
        object: undefined,
        text: 'target',
        totalUsage: { totalTokens: 7 },
      })
      await expect(
        new EvaluatorBlockHandler().execute(block, { model: 'openai/gpt-4.1' }, context)
      ).rejects.toMatchObject({ cost: { status: 'unavailable' }, tokens: { total: 7 } })
    }
  )
  it('interrupts inference when cancellation arrives after generation starts', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const shouldCancelExecution = vi.fn(async () => cancelled)
    native.generate.mockImplementation(
      (_messages, options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          })
        })
    )
    try {
      const execution = new EvaluatorBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1' },
        { ...context, shouldCancelExecution }
      )
      const outcome = expect(execution).rejects.toMatchObject({
        message: 'cancelled',
        tokens: {},
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(native.generate).toHaveBeenCalledTimes(1)
      cancelled = true
      await vi.advanceTimersByTimeAsync(1000)
      await outcome
      expect(shouldCancelExecution).toHaveBeenCalledTimes(2)
      const checks = shouldCancelExecution.mock.calls.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(shouldCancelExecution).toHaveBeenCalledTimes(checks)
    } finally {
      vi.useRealTimers()
    }
  })
})

it('rejects a successful native response without the required structured object', async () => {
  native.generate.mockResolvedValue({
    finishReason: 'stop',
    object: undefined,
    totalUsage: { totalTokens: 7 },
  })
  await expect(
    new EvaluatorBlockHandler().execute(block, { model: 'openai/gpt-4.1' }, context)
  ).rejects.toThrow('valid structured result')
})

it('keeps colliding metric score roots as business data and native facts separately', async () => {
  const { getInferenceFacts } = await import('@/lib/mastra/result')
  native.generate.mockResolvedValue({
    finishReason: 'stop',
    object: { model: 7, tokens: 8, cost: 9, content: 6 },
    totalUsage: { totalTokens: 7 },
  })
  const output = await new EvaluatorBlockHandler().execute(
    block,
    {
      model: 'openai/gpt-4.1',
      content: 'evaluate',
      metrics: ['model', 'tokens', 'cost', 'content'].map((name) => ({
        name,
        range: { min: 0, max: 10 },
      })),
    },
    context
  )
  expect(output).toMatchObject({ model: 7, tokens: 8, cost: 9, content: 6 })
  expect(getInferenceFacts(output)).toMatchObject({
    model: 'openai/gpt-4.1',
    tokens: { total: 7 },
    cost: { status: 'unavailable' },
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
        new EvaluatorBlockHandler().execute(
          block,
          {
            model,
            content: { answer: 42 },
            metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
          },
          context
        )
      ).rejects.toMatchObject({ status: 400 })
      expect(native.finance).not.toHaveBeenCalled()
      expect(native.generate).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  }
)

// Only the native model and usage processor boundaries are controlled.
describe('evaluator trusted failed accounting with real helpers', () => {
  it.each([
    'error',
    'aborted',
    'native error',
    'tripwire',
    'financial refusal',
    'missing structured result',
  ])('retains canonical processor accounting through %s', async (failure) => {
    native.usage.mockReturnValue({ totalTokens: 7 })
    const returned: {
      finishReason: string
      object?: unknown
      totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number }
      error?: unknown
      tripwire?: unknown
    } = {
      ...{ finishReason: 'stop', object: { accuracy: 8 } },
      totalUsage: { inputTokens: 11, outputTokens: 6, totalTokens: 17 },
    }
    if (failure === 'error' || failure === 'aborted') returned.finishReason = failure
    if (failure === 'native error') returned.error = new Error('native failure')
    if (failure === 'tripwire') returned.tripwire = { reason: 'controlled refusal' }
    if (failure === 'missing structured result') returned.object = undefined
    if (failure === 'financial refusal')
      native.verify.mockRejectedValueOnce(new Error('Financial acceptance refused'))
    native.generate.mockResolvedValueOnce(returned)
    let failureValue: unknown
    try {
      await new EvaluatorBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          content: 'evaluate',
          metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
        },
        context
      )
    } catch (error) {
      failureValue = error
    }
    expect(failureValue).toBeInstanceOf(Error)
    const facts = getInferenceFacts(failureValue)
    expect(facts).toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { total: 7 },
      cost: { status: 'unavailable' },
      generatedFields: ['model', 'tokens', 'cost'],
    })
    expect(getInferenceFacts(failureValue)).toBe(facts)
    expect(native.generate).toHaveBeenCalledOnce()
    if (failure === 'financial refusal')
      expect(failureValue).toMatchObject({ message: 'Financial acceptance refused' })
  })
  it.each([
    { usage: {}, expected: {} },
    { usage: { totalTokens: 0 }, expected: { total: 0 } },
  ])(
    'preserves actual processor counts $usage without reading a parallel result total',
    async ({ usage, expected }) => {
      native.usage.mockReturnValue(usage)
      native.verify.mockRejectedValueOnce(new Error('Financial acceptance refused'))
      native.generate.mockResolvedValueOnce({
        finishReason: 'stop',
        object: { accuracy: 8 },
        totalUsage: { totalTokens: 17 },
      })
      const failure = await new EvaluatorBlockHandler()
        .execute(
          block,
          {
            model: 'openai/gpt-4.1',
            content: 'evaluate',
            metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
          },
          context
        )
        .catch((error) => error)
      expect(getInferenceFacts(failure)?.tokens).toEqual(expected)
    }
  )
  it('captures the latest processor observation when financial acceptance rejects', async () => {
    native.usage.mockReturnValue({ totalTokens: 7 })
    native.generate.mockResolvedValueOnce({ finishReason: 'stop', object: { accuracy: 8 } })
    native.verify.mockImplementationOnce(async () => {
      native.usage.mockReturnValue({ totalTokens: 9 })
      throw new Error('Financial acceptance refused')
    })
    let failure: unknown
    try {
      await new EvaluatorBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          content: 'evaluate',
          metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
        },
        context
      )
    } catch (error) {
      failure = error
    }
    expect(getInferenceFacts(failure)?.tokens).toEqual({ total: 9 })
    expect(native.generate).toHaveBeenCalledOnce()
  })
  it('does not invent a zero total before any native response', async () => {
    native.usage.mockReturnValue({})
    native.generate.mockRejectedValueOnce(new Error('No native response'))
    let failure: unknown
    try {
      await new EvaluatorBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          content: 'evaluate',
          metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
        },
        context
      )
    } catch (error) {
      failure = error
    }
    expect(getInferenceFacts(failure)).toMatchObject({
      tokens: {},
      cost: { status: 'unavailable' },
    })
    expect(getInferenceFacts(failure)?.tokens).toEqual({})
    expect(native.generate).toHaveBeenCalledOnce()
  })
})
