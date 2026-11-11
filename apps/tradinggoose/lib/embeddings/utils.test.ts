import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  configs: [] as unknown[],
  validate: vi.fn(),
  key: vi.fn(),
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
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: mocks.admit,
  recordModelUsage: mocks.accept,
}))

import { generateEmbeddings, generateSearchEmbedding } from './utils'

const scope = { actorUserId: 'member-1', workspaceId: 'workspace-1', runId: 'embedding-run-1' }

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
  mocks.admit.mockResolvedValue(undefined)
  mocks.accept.mockResolvedValue(undefined)
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
    for (const stepNumber of [0, 1]) {
      expect(mocks.admit).toHaveBeenNthCalledWith(
        stepNumber + 1,
        expect.objectContaining({ ...scope, purpose: 'embedding' })
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
      expect(mocks.admit).toHaveBeenCalledOnce()
    }
  )

  it('refuses missing actor and cancelled work before admission/contact', async () => {
    await expect(generateEmbeddings(['one'], { actorUserId: '' })).rejects.toThrow(/actor/)
    const controller = new AbortController()
    controller.abort()
    await expect(
      generateEmbeddings(['one'], { ...scope, signal: controller.signal })
    ).rejects.toThrow()
    expect(mocks.admit).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('accepts completed known usage before vector validation and has no transport retry on failure', async () => {
    mocks.embed.mockResolvedValueOnce({ embeddings: [], usage: { tokens: 7 } })
    await expect(generateEmbeddings(['one'], scope)).rejects.toThrow(/vector count/)
    expect(mocks.accept).toHaveBeenCalledWith(expect.anything(), { inputTokens: 7, totalTokens: 7 })
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
  expect(JSON.stringify(mocks.admit.mock.calls)).not.toMatch(/first-key|second-key|apiKey/)
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
  expect(mocks.admit).not.toHaveBeenCalled()
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
