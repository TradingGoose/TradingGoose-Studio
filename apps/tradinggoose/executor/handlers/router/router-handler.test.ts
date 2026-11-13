import { managedServices, setManagedProviders } from '@/lib/mastra/__test-utils__/managed-services'

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
      verifyComplete: () => native.verify(),
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { EMBEDDING_MODELS } from '@mastra/core/llm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getInferenceFacts } from '@/lib/mastra/result'
import { RouterBlockHandler } from './router-handler'

const native = vi.hoisted(() => ({
  finance: vi.fn(),
  cost: vi.fn(),
  usage: vi.fn(),
  verify: vi.fn(),
  generate: vi.fn(),
  configurations: [] as any[],
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(configuration: any) {
      native.configurations.push(configuration)
    }
    generate = native.generate
  },
}))
vi.mock('@/blocks/blocks/router', () => ({
  generateRouterPrompt: (_prompt: string, targets: any[]) =>
    targets.map((target) => target.id).join(','),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))
const block = { id: 'router', metadata: { id: 'router' } } as any
const target = {
  id: 'target',
  metadata: { id: 'agent', name: 'Answer' },
  config: { params: { systemPrompt: 'Answer the question' } },
}
const context = {
  workspaceId: 'workspace',
  userId: 'user',
  blockStates: new Map(),
  workflow: { blocks: [target], connections: [{ source: 'router', target: 'target' }] },
} as any
beforeEach(() => {
  managedServices.credentials.openai = { defaultApiKey: 'managed-fixture-key' }
  vi.clearAllMocks()
  native.cost.mockReset().mockReturnValue({ status: 'unavailable' })
  native.usage.mockReset().mockReturnValue({ totalTokens: 7 })
  native.verify.mockReset().mockResolvedValue(undefined)
  native.configurations.length = 0
  native.generate.mockResolvedValue({
    finishReason: 'stop',
    text: ' TARGET ',
    totalUsage: { totalTokens: 7 },
  })
})
describe('Router native generation', () => {
  it('retains selected-path workflow fields and native accounting independently of dollars', async () => {
    const cost = {
      input: 0.002,
      output: 0.003,
      total: 0.005,
      currency: 'USD',
      estimated: true,
      status: 'estimated',
    }
    native.cost.mockReturnValue(cost)
    const result = await new RouterBlockHandler().execute(
      block,
      { model: 'openai/gpt-4.1', prompt: 'Route', apiKey: 'local-key', temperature: 0 },
      context
    )
    expect(result).toMatchObject({
      model: 'openai/gpt-4.1',
      selectedPath: { blockId: 'target', blockType: 'agent', blockTitle: 'Answer' },
      tokens: { total: 7 },
      cost,
    })
    expect(getInferenceFacts(result)).toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { total: 7 },
      cost,
    })
    expect(result).toMatchObject({ tokens: { total: 7 } })
    expect(native.configurations[0].model).toEqual({ id: 'openai/gpt-4.1', apiKey: 'local-key' })
    expect(native.generate.mock.calls[0][1].modelSettings.temperature).toBe(0)
  })
  it('rejects decisions outside the connected workflow paths', async () => {
    native.generate.mockResolvedValue({ finishReason: 'stop', text: 'unconnected', totalUsage: {} })
    await expect(
      new RouterBlockHandler().execute(block, { model: 'openai/gpt-4.1' }, context)
    ).rejects.toThrow('Invalid routing decision')
  })
  it('rejects dangling target connections before inference', async () => {
    await expect(
      new RouterBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1' },
        { ...context, workflow: { ...context.workflow, blocks: [] } }
      )
    ).rejects.toThrow('Target block target not found')
    expect(native.generate).not.toHaveBeenCalled()
  })
})

describe('router incomplete native outcomes and workflow cancellation', () => {
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
        new RouterBlockHandler().execute(block, { model: 'openai/gpt-4.1' }, context)
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
      const execution = new RouterBlockHandler().execute(
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

it.each(EMBEDDING_MODELS.map(({ provider, id }) => [`${provider}/${id}`, provider, id] as const))(
  'refuses native-known embedding model %s before generation admission or model contact',
  async (model, provider, modelId) => {
    // Trusted deployment membership is explicit; purpose rejection uses real installed native metadata.
    setManagedProviders({
      [provider]: {
        name: 'Controlled registered provider',
        url: 'https://not-contacted.invalid',
        models: [modelId],
      },
    })
    try {
      await expect(
        new RouterBlockHandler().execute(block, { model, prompt: 'Route this request' }, context)
      ).rejects.toMatchObject({ status: 400 })
      expect(native.finance).not.toHaveBeenCalled()
      expect(native.configurations).toEqual([])
      expect(native.generate).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  }
)

// Only the native model and usage processor boundaries are controlled.
describe('router trusted failed accounting with real helpers', () => {
  it.each([
    'error',
    'aborted',
    'native error',
    'tripwire',
    'financial refusal',
    'invalid routing decision',
  ])('retains canonical processor accounting through %s', async (failure) => {
    native.usage.mockReturnValue({ totalTokens: 7 })
    const returned: {
      finishReason: string
      text: string
      totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number }
      error?: unknown
      tripwire?: unknown
    } = {
      ...{ finishReason: 'stop', text: 'target' },
      totalUsage: { inputTokens: 11, outputTokens: 6, totalTokens: 17 },
    }
    if (failure === 'error' || failure === 'aborted') returned.finishReason = failure
    if (failure === 'native error') returned.error = new Error('native failure')
    if (failure === 'tripwire') returned.tripwire = { reason: 'controlled refusal' }
    if (failure === 'invalid routing decision') returned.text = 'unconnected'
    if (failure === 'financial refusal')
      native.verify.mockRejectedValueOnce(new Error('Financial acceptance refused'))
    native.generate.mockResolvedValueOnce(returned)
    let failureValue: unknown
    try {
      await new RouterBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', prompt: 'Route' },
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
        text: 'target',
        totalUsage: { totalTokens: 17 },
      })
      const failure = await new RouterBlockHandler()
        .execute(block, { model: 'openai/gpt-4.1', prompt: 'Route' }, context)
        .catch((error) => error)
      expect(getInferenceFacts(failure)?.tokens).toEqual(expected)
    }
  )
  it('captures the latest processor observation when financial acceptance rejects', async () => {
    native.usage.mockReturnValue({ totalTokens: 7 })
    native.generate.mockResolvedValueOnce({ finishReason: 'stop', text: 'target' })
    native.verify.mockImplementationOnce(async () => {
      native.usage.mockReturnValue({ totalTokens: 9 })
      throw new Error('Financial acceptance refused')
    })
    let failure: unknown
    try {
      await new RouterBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', prompt: 'Route' },
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
      await new RouterBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', prompt: 'Route' },
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
