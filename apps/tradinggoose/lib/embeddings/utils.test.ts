import {
  type FinancialBinding,
  financialFingerprint,
  type ModelOccurrence,
  type OperationReceipt,
  occurrenceKey,
} from '@tradinggoose/billing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  configs: [] as unknown[],
  validate: vi.fn(),
  key: vi.fn(),
  create: vi.fn(),
  admit: vi.fn(),
  accept: vi.fn(),
}))
vi.mock('@mastra/core/llm', () => ({
  ModelRouterEmbeddingModel: class {
    maxEmbeddingsPerCall = 2
    constructor(config: unknown) {
      mocks.configs.push(config)
    }
    doEmbed(args: unknown) {
      return mocks.embed(args)
    }
  },
}))
vi.mock('@/lib/mastra/connections', () => ({
  resolveConfiguredModel: (id: string, apiKey?: string) => ({ id, apiKey }),
}))
vi.mock('@/lib/mastra/registry', () => ({ assertListedEmbeddingModel: mocks.validate }))
vi.mock('@/lib/system-services/runtime', () => ({ resolveOpenAIServiceConfig: mocks.key }))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: mocks.create,
  admitFinancialModelStep: mocks.admit,
  acceptFinancialModelStep: mocks.accept,
}))

import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { generateEmbeddings, generateSearchEmbedding } from './utils'

const scope = { actorUserId: 'member-1', workspaceId: 'workspace-1', runId: 'embedding-run-1' }

function acceptedReceipt(binding: FinancialBinding, occurrence: ModelOccurrence): OperationReceipt {
  return {
    recordType: 'operation',
    fingerprint: financialFingerprint([binding.fingerprint, occurrenceKey(binding, occurrence)]),
    binding,
    identity: {
      root: { type: 'user', id: binding.actorUserId },
      actorUserId: binding.actorUserId,
      memberUserId: null,
      scope: 'user',
      period: null,
      billingEnabled: false,
      quote: {
        holdUsd: '0',
        multiplier: '1',
        modelUsd: 'unavailable',
        baseChargeUsd: '0',
        defaultGrant: false,
        billable: true,
      },
      workspaceId: binding.workspaceId,
      workflowId: binding.workflowId,
      purpose: binding.purpose,
    },
    holdState: 'closed',
    contactState: 'accepted',
    appliedUsd: '0',
    modelUsd: 'unavailable',
    financialClosureState: 'closed',
    dispatchState: 'complete',
    dispatchAtMs: 0,
    markers: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configs.length = 0
  mocks.validate.mockReturnValue({
    id: 'openai/text-embedding-3-small',
    provider: 'openai',
    dimensions: 1536,
    maxInputTokens: 8191,
  })
  mocks.key.mockResolvedValue({ defaultApiKey: 'request-local' })
  mocks.create.mockImplementation(async (input) => ({
    ...input,
    namespace: `billing-usage:user:${input.actorUserId}`,
    key: `invocation:${input.operationKey}`,
    fingerprint: 'bound',
    workspaceId: input.workspaceId ?? null,
    workflowId: input.workflowId ?? null,
  }))
  mocks.admit.mockResolvedValue(undefined)
  mocks.accept.mockImplementation(async (binding, occurrence) =>
    acceptedReceipt(binding, occurrence)
  )
})

describe('native embeddings', () => {
  it('keeps vectors ordered and accounts each native batch once', async () => {
    mocks.embed
      .mockResolvedValueOnce({ embeddings: [[1], [2]], usage: { tokens: 10 } })
      .mockResolvedValueOnce({ embeddings: [[3]], usage: { tokens: 5 } })
    const result = await generateEmbeddings(['one', 'two', 'three'], scope)
    expect(result.embeddings).toEqual([[1], [2], [3]])
    expect(result.tokens).toEqual({ prompt: 15, total: 15 })
    expect(result.usage).toEqual({ status: 'reported', batches: 2 })
    expect(result.cost).toEqual({ status: 'unavailable' })
    expect(mocks.configs).toEqual([
      { id: 'openai/text-embedding-3-small', apiKey: 'request-local' },
    ])
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      ...scope,
      purpose: 'embedding',
      operationKey: scope.runId,
      workflowId: undefined,
    })
    for (const stepNumber of [0, 1]) {
      const occurrence = { runId: scope.runId, stepNumber, retryCount: 0 }
      expect(mocks.admit).toHaveBeenNthCalledWith(
        stepNumber + 1,
        expect.objectContaining({ fingerprint: 'bound' }),
        occurrence
      )
      expect(mocks.admit.mock.invocationCallOrder[stepNumber]).toBeLessThan(
        mocks.embed.mock.invocationCallOrder[stepNumber]
      )
      expect(mocks.embed.mock.invocationCallOrder[stepNumber]).toBeLessThan(
        mocks.accept.mock.invocationCallOrder[stepNumber]
      )
    }
    expect(mocks.accept.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.admit.mock.invocationCallOrder[1]
    )
  })

  it('leaves missing usage and USD unavailable', async () => {
    mocks.embed.mockResolvedValueOnce({ embeddings: [[1]] })
    expect(await generateSearchEmbedding('one', scope)).toMatchObject({
      embedding: [1],
      tokens: {},
      usage: { status: 'unavailable' },
      cost: { status: 'unavailable' },
    })
  })

  it('retains completed native batches and unavailable USD when a later batch fails', async () => {
    const failure = new Error('second batch failed')
    mocks.embed
      .mockResolvedValueOnce({ embeddings: [[1], [2]], usage: { tokens: 10 } })
      .mockRejectedValueOnce(failure)
    await expect(generateEmbeddings(['one', 'two', 'three'], scope)).rejects.toMatchObject({
      message: 'second batch failed',
      model: 'openai/text-embedding-3-small',
      tokens: { prompt: 10, total: 10 },
      embeddingUsage: { status: 'partial', batches: 1 },
      cost: { status: 'unavailable' },
      completedEmbeddings: [[1], [2]],
    })
  })

  it('retains known usage when a completed response has invalid vectors', async () => {
    mocks.embed.mockResolvedValueOnce({ embeddings: [], usage: { tokens: 7 } })
    await expect(generateEmbeddings(['one'], scope)).rejects.toMatchObject({
      tokens: { prompt: 7, total: 7 },
      embeddingUsage: { status: 'partial', batches: 1 },
      cost: { status: 'unavailable' },
    })
  })

  it('does not invent tokens when the first batch fails', async () => {
    mocks.embed.mockRejectedValueOnce(new Error('connection failed'))
    await expect(generateEmbeddings(['one'], scope)).rejects.toMatchObject({
      tokens: {},
      embeddingUsage: { status: 'unavailable', batches: 0 },
      cost: { status: 'unavailable' },
    })
  })

  it('rejects an unlisted model before resolving credentials or making a request', async () => {
    mocks.validate.mockImplementationOnce(() => {
      throw new Error('Select a listed provider/model')
    })
    await expect(generateEmbeddings(['one'], scope, 'bare-model')).rejects.toThrow(
      'Select a listed provider/model'
    )
    expect(mocks.key).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it.each(['admit', 'accept'] as const)(
    'does not contact the next batch after %s failure',
    async (phase) => {
      mocks.embed.mockResolvedValue({ embeddings: [[1], [2]], usage: { tokens: 10 } })
      mocks[phase].mockRejectedValueOnce(new Error(`${phase} rejected`))
      await expect(generateEmbeddings(['one', 'two', 'three'], scope)).rejects.toThrow(
        `${phase} rejected`
      )
      expect(mocks.embed).toHaveBeenCalledTimes(phase === 'admit' ? 0 : 1)
      expect(mocks.create).toHaveBeenCalledOnce()
    }
  )

  it('refuses missing actor and cancelled work before admission/contact', async () => {
    await expect(generateEmbeddings(['one'], { actorUserId: '' })).rejects.toThrow(/actor/)
    const controller = new AbortController()
    controller.abort()
    await expect(
      generateEmbeddings(['one'], { ...scope, signal: controller.signal })
    ).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('accepts completed known usage before vector validation and has no transport retry on failure', async () => {
    mocks.embed.mockResolvedValueOnce({ embeddings: [], usage: { tokens: 7 } })
    await expect(generateEmbeddings(['one'], scope)).rejects.toThrow(/vector count/)
    expect(mocks.accept).toHaveBeenCalledWith(expect.anything(), {
      runId: scope.runId,
      stepNumber: 0,
      retryCount: 0,
      usage: { inputTokens: 7, totalTokens: 7 },
    })
    expect(mocks.embed).toHaveBeenCalledOnce()
  })
})

it('uses explicit request-local credentials without resolving or mutating service/environment keys', async () => {
  const original = process.env.OPENAI_API_KEY
  mocks.embed.mockResolvedValue({ embeddings: [[1]] })
  await generateEmbeddings(['first'], { ...scope, apiKey: 'first-key' })
  await generateEmbeddings(['second'], { ...scope, apiKey: 'second-key' })
  expect(mocks.configs).toEqual([
    { id: 'openai/text-embedding-3-small', apiKey: 'first-key' },
    { id: 'openai/text-embedding-3-small', apiKey: 'second-key' },
  ])
  expect(mocks.key).not.toHaveBeenCalled()
  expect(process.env.OPENAI_API_KEY).toBe(original)
  expect(mocks.create.mock.calls.flat()).not.toContain('first-key')
  expect(JSON.stringify(mocks.create.mock.calls)).not.toMatch(/first-key|second-key|apiKey/)
})

it('keeps a valid long native input beyond the grouping target byte-for-byte and rejects native-limit excess before credentials/admission', async () => {
  const { getAccurateTokenCount } = await import('@/lib/tokenization')
  const valid = 'hello '.repeat(8050)
  expect(getAccurateTokenCount(valid, 'openai/text-embedding-3-small')).toBeGreaterThan(8000)
  expect(getAccurateTokenCount(valid, 'openai/text-embedding-3-small')).toBeLessThanOrEqual(8191)
  mocks.embed.mockResolvedValueOnce({ embeddings: [[1]], usage: { tokens: 8051 } })
  await generateEmbeddings([valid], { ...scope, apiKey: 'long-input-key' })
  expect(mocks.embed).toHaveBeenCalledExactlyOnceWith({ values: [valid], abortSignal: undefined })
  vi.clearAllMocks()
  await expect(generateEmbeddings(['hello '.repeat(8200)], scope)).rejects.toThrow(
    '8191 token limit'
  )
  expect(mocks.key).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.embed).not.toHaveBeenCalled()
})

it('propagates actual caller cancellation and retains accepted completed usage before refusing another contact', async () => {
  const controller = new AbortController()
  mocks.embed.mockImplementationOnce(async ({ abortSignal }) => {
    expect(abortSignal).toBe(controller.signal)
    controller.abort()
    return { embeddings: [[1], [2]], usage: { tokens: 7 } }
  })
  await expect(
    generateEmbeddings(['one', 'two', 'three'], { ...scope, signal: controller.signal })
  ).rejects.toMatchObject({
    completedEmbeddings: [[1], [2]],
    tokens: { prompt: 7, total: 7 },
    embeddingUsage: { status: 'partial', batches: 1 },
  })
  expect(mocks.accept).toHaveBeenCalledOnce()
  expect(mocks.embed).toHaveBeenCalledOnce()
})

it('preserves vectors and completed facts when transaction acknowledgement is unavailable', async () => {
  mocks.embed.mockResolvedValueOnce({ embeddings: [[1]], usage: { tokens: 3 } })
  mocks.accept.mockRejectedValueOnce(new Error('Canonical transaction acknowledgement unavailable'))
  await expect(generateEmbeddings(['one'], scope)).rejects.toMatchObject({
    completedEmbeddings: [[1]],
    tokens: { prompt: 3, total: 3 },
    embeddingUsage: { status: 'partial', batches: 1 },
    cost: { status: 'unavailable' },
  })
  expect(mocks.accept).toHaveBeenCalledOnce()
})

it('revalidates trusted source before create and after each admission, with stable child identity', async () => {
  const verifySource = vi.fn(async () => {})
  mocks.embed.mockResolvedValue({ embeddings: [[1]], usage: { tokens: 3 } })
  const result = await generateSearchEmbedding('one', {
    ...scope,
    expectedNamespace: 'billing-usage:organization:original',
    verifySource,
  })
  expect(verifySource).toHaveBeenCalledTimes(2)
  expect(verifySource.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.create.mock.invocationCallOrder[0]
  )
  expect(mocks.admit.mock.invocationCallOrder[0]).toBeLessThan(
    verifySource.mock.invocationCallOrder[1]
  )
  expect(verifySource.mock.invocationCallOrder[1]).toBeLessThan(
    mocks.create.mock.invocationCallOrder[1]
  )
  expect(mocks.create.mock.invocationCallOrder[1]).toBeLessThan(
    mocks.embed.mock.invocationCallOrder[0]
  )
  expect(mocks.create).toHaveBeenCalledTimes(2)
  expect(mocks.create.mock.calls[1][0]).toBe(mocks.create.mock.calls[0][0])
  expect(mocks.admit).toHaveBeenCalledOnce()
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: scope.runId,
      operationKey: scope.runId,
      purpose: 'embedding',
      expectedNamespace: 'billing-usage:organization:original',
    })
  )
  expect(getInferenceFacts(result)).toMatchObject({
    model: result.model,
    tokens: { prompt: 3, total: 3 },
    embeddingUsage: { status: 'reported', batches: 1 },
  })
})
it.each(['before-create', 'after-admission'])(
  'refuses changed source %s without embedding or new key/retry',
  async (when) => {
    const failure = new Error('Original Pending changed')
    const verifySource = vi.fn(async () => {})
    if (when === 'before-create') verifySource.mockRejectedValueOnce(failure)
    else verifySource.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)
    await expect(generateSearchEmbedding('one', { ...scope, verifySource })).rejects.toBe(failure)
    expect(mocks.create).toHaveBeenCalledTimes(when === 'before-create' ? 0 : 1)
    expect(mocks.admit).toHaveBeenCalledTimes(when === 'before-create' ? 0 : 1)
    expect(mocks.embed).not.toHaveBeenCalled()
    expect(mocks.accept).not.toHaveBeenCalled()
  }
)
it('keeps an existing branded producer Error intact without assigning its readonly Symbol', async () => {
  const facts = { model: 'known/embedding', tokens: { total: 7 }, generatedFields: ['tokens'] }
  const failure = withInferenceFacts(
    Object.assign(new Error('Known original error'), { tokens: { total: 7 } }),
    facts
  )
  mocks.embed.mockRejectedValueOnce(failure)
  await expect(generateSearchEmbedding('one', scope)).rejects.toBe(failure)
  expect(getInferenceFacts(failure)).toBe(facts)
  expect(failure.tokens).toEqual({ total: 7 })
  expect(failure).not.toHaveProperty('completedEmbeddings')
  expect(mocks.embed).toHaveBeenCalledOnce()
})

it.each([
  'rejected',
  'missing',
  'changed-key',
  'changed-fingerprint',
  'changed-actor',
  'cancelled',
])('refuses trusted final child readback %s before contact without readmission', async (kind) => {
  const controller = new AbortController()
  const scopeWithProof = {
    ...scope,
    signal: controller.signal,
    expectedNamespace: `billing-usage:user:${scope.actorUserId}`,
    verifySource: vi.fn(async () => {}),
  }
  let initial: any
  mocks.create
    .mockImplementationOnce(async (input) => {
      initial = {
        namespace: scopeWithProof.expectedNamespace,
        key: `invocation:${input.operationKey}`,
        fingerprint: 'actual-original-child',
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId ?? null,
        workflowId: input.workflowId ?? null,
        runId: input.runId,
        purpose: input.purpose,
      }
      return initial
    })
    .mockImplementationOnce(async () => {
      if (kind === 'rejected') throw new Error('Current child authorization refused')
      if (kind === 'missing') return undefined
      if (kind === 'changed-key') return { ...initial, key: 'different child' }
      if (kind === 'changed-fingerprint') return { ...initial, fingerprint: 'different identity' }
      if (kind === 'changed-actor') return { ...initial, actorUserId: 'different actor' }
      controller.abort()
      return { ...initial }
    })
  await expect(generateSearchEmbedding('one', scopeWithProof)).rejects.toThrow()
  expect(mocks.create).toHaveBeenCalledTimes(2)
  expect(mocks.create.mock.calls[1][0]).toBe(mocks.create.mock.calls[0][0])
  expect(mocks.admit).toHaveBeenCalledExactlyOnceWith(initial, {
    runId: scope.runId,
    stepNumber: 0,
    retryCount: 0,
  })
  expect(mocks.embed).not.toHaveBeenCalled()
  expect(mocks.accept).not.toHaveBeenCalled()
})
