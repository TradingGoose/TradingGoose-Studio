import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  accept: vi.fn(),
}))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: async () => {
    mocks.order.push('admit')
  },
  recordModelUsage: mocks.accept,
}))
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<object>()),
  resolveConfiguredModel: (_model: string, apiKey?: string) => ({
    providerId: 'fixture',
    modelId: 'embedding',
    url: 'http://fixture.invalid/v1',
    apiKey: apiKey ?? 'fixture-key',
  }),
}))
vi.mock('@/lib/mastra/registry', () => ({
  assertListedEmbeddingModel: () => ({
    id: 'openai/text-embedding-3-small',
    provider: 'openai',
    dimensions: 1536,
    maxInputTokens: 8191,
  }),
}))
vi.mock('@/lib/system-services/runtime', () => ({ resolveOpenAIServiceConfig: async () => ({}) }))

import { generateEmbeddings } from '@/lib/embeddings/utils'

beforeEach(() => {
  mocks.order.length = 0
  vi.clearAllMocks()
  mocks.accept.mockImplementation(async (_scope, _usage, cost) => {
    mocks.order.push('accept')
    return cost
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('installed native direct embedding transport', () => {
  it('admits/accepts every actual native batch before further provider contact', async () => {
    const fetch = vi.fn(async (_url, options: RequestInit) => {
      mocks.order.push('http')
      const input = JSON.parse(String(options.body)).input as string[]
      return Response.json({
        object: 'list',
        model: 'embedding',
        data: input.map((_text, index) => ({ object: 'embedding', embedding: [index, 1], index })),
        usage: { prompt_tokens: input.length, total_tokens: input.length },
      })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await generateEmbeddings(
      Array.from({ length: 2049 }, () => 'hello'),
      {
        actorUserId: 'member-1',
        workspaceId: 'workspace-1',
        runId: 'native-embedding-run',
      }
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.embeddings).toHaveLength(2049)
    expect(result.tokens).toEqual({ prompt: 2049, total: 2049 })
    expect(result.cost).toMatchObject({
      status: 'estimated',
      total: expect.closeTo(0.00004098, 12),
      currency: 'USD',
    })
    expect(mocks.order).toEqual(['admit', 'http', 'accept', 'admit', 'http', 'accept'])
    expect(mocks.accept.mock.calls.map((call) => call[1])).toEqual([
      { inputTokens: 2048, totalTokens: 2048 },
      { inputTokens: 1, totalTokens: 1 },
    ])
    expect(mocks.accept.mock.calls.map((call) => call[2].total)).toEqual([
      expect.closeTo(0.00004096, 12),
      expect.closeTo(0.00000002, 12),
    ])
    expect(mocks.accept.mock.calls.every(([scope]) => scope.funding === 'account')).toBe(true)
  })

  it.each([429, 500])(
    'delegates only once for retryable HTTP %i, retaining the uncertain admitted occurrence',
    async (status) => {
      const fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'retryable provider failure' } }), {
            status,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          })
      )
      vi.stubGlobal('fetch', fetch)
      await expect(
        generateEmbeddings(['hello'], { actorUserId: 'member-1', runId: 'failed-native-embedding' })
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledOnce()
      expect(mocks.order).toEqual(['admit'])
      expect(mocks.accept).not.toHaveBeenCalled()
    }
  )
})

it('uses each request-owned credential and actual abort signal without changing accepted input bytes', async () => {
  const requests: Array<{
    key: string | null
    input: string[]
    signal: AbortSignal | null | undefined
  }> = []
  const fetch = vi.fn(async (_url, options: RequestInit) => {
    const input = JSON.parse(String(options.body)).input as string[]
    requests.push({
      key: new Headers(options.headers).get('authorization'),
      input,
      signal: options.signal,
    })
    return Response.json({
      object: 'list',
      model: 'embedding',
      data: input.map((_text, index) => ({ object: 'embedding', embedding: [index, 1], index })),
    })
  })
  vi.stubGlobal('fetch', fetch)
  const long = 'hello '.repeat(8050)
  const controller = new AbortController()
  const one = await generateEmbeddings([long], {
    actorUserId: 'actor',
    apiKey: 'first-key',
    signal: controller.signal,
  })
  const two = await generateEmbeddings([' exact🔥\n ', 'duplicate', 'duplicate'], {
    actorUserId: 'actor',
    apiKey: 'second-key',
  })
  expect(requests).toEqual([
    { key: 'Bearer first-key', input: [long], signal: controller.signal },
    {
      key: 'Bearer second-key',
      input: [' exact🔥\n ', 'duplicate', 'duplicate'],
      signal: undefined,
    },
  ])
  expect(one.tokens).toEqual({})
  expect(two.tokens).toEqual({})
  expect(one.usage.status).toBe('unavailable')
  expect(one.cost).toMatchObject({ accountCost: null })
  expect(two.cost).toMatchObject({ accountCost: null })
  expect(mocks.accept.mock.calls.every(([scope]) => scope.funding === 'byok')).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(2)
})
