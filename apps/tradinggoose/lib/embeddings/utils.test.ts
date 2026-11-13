import '@/lib/mastra/__test-utils__/managed-services'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  configs: [] as unknown[],
  validate: vi.fn(),
  key: vi.fn(),
  admit: vi.fn(),
  begin: vi.fn(),
  accept: vi.fn(),
}))
vi.mock('@mastra/core/llm', async (original) => ({
  ...(await original<object>()),
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
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<object>()),
  resolveConfiguredModel: async (id: string, apiKey?: string) => ({
    id,
    apiKey: apiKey ?? (await mocks.key()).defaultApiKey,
  }),
}))
vi.mock('@/lib/mastra/registry', () => ({ assertListedEmbeddingModel: mocks.validate }))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: mocks.admit,
  beginWorkflowModelUsage: mocks.begin,
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
  mocks.begin.mockResolvedValue(false)
  mocks.accept.mockImplementation(async (_scope, _usage, cost) => cost)
})

describe('native embeddings', () => {
  it('records distinct provider contacts when callers reuse a run label', async () => {
    mocks.embed.mockResolvedValue({ embeddings: [[1]], usage: { tokens: 1 } })
    await generateEmbeddings(['one'], scope)
    await generateEmbeddings(['one'], scope)
    const ids = mocks.begin.mock.calls.map((call) => call[1])
    expect(ids).toEqual([
      expect.stringMatching(/^embedding-run-1:embedding:[^:]+:0$/),
      expect.stringMatching(/^embedding-run-1:embedding:[^:]+:0$/),
    ])
    expect(new Set(ids).size).toBe(2)
    expect(mocks.accept.mock.calls.map((call) => call[3])).toEqual(ids)
  })

  it('awaits durable attempt ownership before embedding contact and completes its batch ID', async () => {
    let admit!: (owned: boolean) => void
    mocks.begin.mockReturnValue(
      new Promise<boolean>((resolve) => {
        admit = resolve
      })
    )
    mocks.embed.mockResolvedValueOnce({ embeddings: [[1]], usage: { tokens: 1 } })
    const generating = generateEmbeddings(['one'], scope)
    await vi.waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce())
    expect(mocks.embed).not.toHaveBeenCalled()
    expect(mocks.accept).not.toHaveBeenCalled()
    admit(true)
    await generating
    expect(mocks.embed).toHaveBeenCalledOnce()
    expect(mocks.accept.mock.calls[0][3]).toBe(mocks.begin.mock.calls[0][1])
  })

  it('does not contact embeddings when attempt persistence fails', async () => {
    const failure = new Error('Native attempt persistence failed')
    mocks.begin.mockRejectedValueOnce(failure)
    await expect(generateEmbeddings(['one'], scope)).rejects.toBe(failure)
    expect(mocks.embed).not.toHaveBeenCalled()
    expect(mocks.accept).not.toHaveBeenCalled()
  })

  it('reports the authoritative account-funded amount returned by usage recording', async () => {
    const charged = {
      input: 0.00000006,
      output: 0,
      total: 0.00000006,
      status: 'estimated' as const,
      estimated: true,
      currency: 'USD',
    }
    mocks.embed.mockResolvedValueOnce({ embeddings: [[1]], usage: { tokens: 1 } })
    mocks.accept.mockResolvedValueOnce(charged)

    const result = await generateEmbeddings(['one'], scope)

    expect(result.cost).toEqual(charged)
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({ ...scope, funding: 'account' }),
      { inputTokens: 1, totalTokens: 1 },
      expect.objectContaining({ total: expect.closeTo(0.00000002, 12) }),
      expect.stringMatching(/^embedding-run-1:embedding:[^:]+:0$/)
    )
  })

  it('keeps vectors ordered and accounts each native batch once', async () => {
    mocks.embed
      .mockResolvedValueOnce({ embeddings: [[1], [2]], usage: { tokens: 10 } })
      .mockResolvedValueOnce({ embeddings: [[3]], usage: { tokens: 5 } })
    const result = await generateEmbeddings(['one', 'two', 'three'], scope)
    expect(result.embeddings).toEqual([[1], [2], [3]])
    expect(result.tokens).toEqual({ prompt: 15, total: 15 })
    expect(result.usage).toEqual({ status: 'reported', batches: 2 })
    expect(result.cost).toMatchObject({
      status: 'estimated',
      input: expect.closeTo(0.0000003, 12),
      total: expect.closeTo(0.0000003, 12),
      currency: 'USD',
    })
    expect(mocks.accept.mock.calls.map((call) => call[2].total)).toEqual([
      expect.closeTo(0.0000002, 12),
      expect.closeTo(0.0000001, 12),
    ])
    expect(mocks.configs).toEqual([
      { id: 'openai/text-embedding-3-small', apiKey: 'request-local' },
    ])
    for (const stepNumber of [0, 1]) {
      expect(mocks.admit).toHaveBeenNthCalledWith(
        stepNumber + 1,
        expect.objectContaining({ ...scope, purpose: 'embedding' })
      )
      expect(mocks.admit.mock.invocationCallOrder[stepNumber]).toBeLessThan(
        mocks.begin.mock.invocationCallOrder[stepNumber]
      )
      expect(mocks.begin.mock.invocationCallOrder[stepNumber]).toBeLessThan(
        mocks.embed.mock.invocationCallOrder[stepNumber]
      )
      expect(mocks.embed.mock.invocationCallOrder[stepNumber]).toBeLessThan(
        mocks.accept.mock.invocationCallOrder[stepNumber]
      )
    }
    expect(mocks.accept.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.admit.mock.invocationCallOrder[1]
    )
    expect(mocks.begin.mock.calls.map((call) => call[1])).toEqual([
      expect.stringMatching(/^embedding-run-1:embedding:[^:]+:0$/),
      expect.stringMatching(/^embedding-run-1:embedding:[^:]+:1$/),
    ])
    expect(mocks.accept.mock.calls.map((call) => call[3])).toEqual(
      mocks.begin.mock.calls.map((call) => call[1])
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

  it('retains completed native usage and partial cost when a later batch fails', async () => {
    const failure = new Error('second batch failed')
    mocks.embed
      .mockResolvedValueOnce({ embeddings: [[1], [2]], usage: { tokens: 10 } })
      .mockRejectedValueOnce(failure)
    await expect(generateEmbeddings(['one', 'two', 'three'], scope)).rejects.toMatchObject({
      message: 'second batch failed',
      model: 'openai/text-embedding-3-small',
      tokens: { prompt: 10, total: 10 },
      embeddingUsage: { status: 'partial', batches: 1 },
      cost: {
        status: 'partial',
        availableTotal: expect.closeTo(0.0000002, 12),
        currency: 'USD',
      },
      completedEmbeddings: [[1], [2]],
    })
  })

  it('accepts known usage before rejecting invalid vectors without retrying', async () => {
    mocks.embed.mockResolvedValueOnce({ embeddings: [], usage: { tokens: 7 } })
    await expect(generateEmbeddings(['one'], scope)).rejects.toMatchObject({
      message: expect.stringMatching(/vector count/),
      tokens: { prompt: 7, total: 7 },
      embeddingUsage: { status: 'partial', batches: 1 },
      cost: { status: 'estimated', total: expect.closeTo(0.00000014, 12), currency: 'USD' },
    })
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/text-embedding-3-small' }),
      { inputTokens: 7, totalTokens: 7 },
      expect.objectContaining({ status: 'estimated', total: expect.closeTo(0.00000014, 12) }),
      expect.stringMatching(/^embedding-run-1:embedding:[^:]+:0$/)
    )
    expect(mocks.embed).toHaveBeenCalledOnce()
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
})

it('uses explicit request-local credentials without resolving or mutating service/environment keys', async () => {
  const original = process.env.OPENAI_API_KEY
  mocks.embed.mockResolvedValue({ embeddings: [[1]] })
  const first = await generateEmbeddings(['first'], { ...scope, apiKey: 'first-key' })
  const second = await generateEmbeddings(['second'], { ...scope, apiKey: 'second-key' })
  expect(mocks.configs).toEqual([
    { id: 'openai/text-embedding-3-small', apiKey: 'first-key' },
    { id: 'openai/text-embedding-3-small', apiKey: 'second-key' },
  ])
  expect(mocks.key).not.toHaveBeenCalled()
  expect(first.cost).toMatchObject({ accountCost: null })
  expect(second.cost).toMatchObject({ accountCost: null })
  for (const [usedScope] of mocks.admit.mock.calls) expect(usedScope.funding).toBe('byok')
  expect(process.env.OPENAI_API_KEY).toBe(original)
  expect(JSON.stringify(mocks.admit.mock.calls)).not.toMatch(/first-key|second-key|apiKey/)
})

it.each(['', '  '])(
  'rejects a blank BYOK key %j before any account fallback or contact',
  async (apiKey) => {
    await expect(generateEmbeddings(['one'], { ...scope, apiKey })).rejects.toThrow(
      'nonempty request-local embedding API key'
    )
    expect(mocks.key).not.toHaveBeenCalled()
    expect(mocks.admit).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
  }
)

it('keeps BYOK cost report-only after a later batch fails', async () => {
  mocks.embed
    .mockResolvedValueOnce({ embeddings: [[1], [2]], usage: { tokens: 10 } })
    .mockRejectedValueOnce(new Error('second batch failed'))
  await expect(
    generateEmbeddings(['one', 'two', 'three'], { ...scope, apiKey: 'caller-key' })
  ).rejects.toMatchObject({
    cost: {
      status: 'partial',
      availableTotal: expect.closeTo(0.0000002, 12),
      accountCost: null,
    },
  })
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
    cost: { status: 'estimated', total: expect.closeTo(0.00000006, 12), currency: 'USD' },
  })
  expect(mocks.accept).toHaveBeenCalledOnce()
})
