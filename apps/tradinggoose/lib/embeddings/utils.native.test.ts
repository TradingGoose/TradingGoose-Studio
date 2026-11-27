import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { managedServices } from '@/lib/mastra/__test-utils__/managed-services'

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  accept: vi.fn(),
  begin: vi.fn(),
}))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: async () => {
    mocks.order.push('admit')
  },
  beginWorkflowModelUsage: mocks.begin,
  recordModelUsage: mocks.accept,
}))

import { generateEmbeddings, generateSearchEmbedding } from '@/lib/embeddings/utils'

beforeEach(() => {
  managedServices.credentials.openai = { defaultApiKey: 'fixture-key' }
  mocks.order.length = 0
  vi.clearAllMocks()
  mocks.begin.mockImplementation(async () => {
    mocks.order.push('begin')
    return false
  })
  mocks.accept.mockImplementation(async (_scope, _usage, cost) => {
    mocks.order.push('accept')
    return cost
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('installed native embedding transport', () => {
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
    expect(result.embeddings).toEqual([
      ...Array.from({ length: 2048 }, (_, index) => [index, 1]),
      [0, 1],
    ])
    expect(result.tokens).toEqual({ prompt: 2049, total: 2049 })
    expect(result.usage).toEqual({ status: 'reported', batches: 2 })
    expect(result.cost).toMatchObject({
      input: expect.closeTo(0.00004098, 12),
      total: expect.closeTo(0.00004098, 12),
      currency: 'USD',
    })
    expect(mocks.order).toEqual([
      'admit',
      'begin',
      'http',
      'accept',
      'admit',
      'begin',
      'http',
      'accept',
    ])
    expect(mocks.begin.mock.calls.map((call) => call[1])).toEqual([
      expect.stringMatching(/^native-embedding-run:embedding:[^:]+:0$/),
      expect.stringMatching(/^native-embedding-run:embedding:[^:]+:1$/),
    ])
    expect(mocks.accept.mock.calls.map((call) => call[3])).toEqual(
      mocks.begin.mock.calls.map((call) => call[1])
    )
    expect(mocks.accept.mock.calls.map((call) => call[1])).toEqual([
      { inputTokens: 2048, totalTokens: 2048 },
      { inputTokens: 1, totalTokens: 1 },
    ])
    expect(mocks.accept.mock.calls.map((call) => call[2].total)).toEqual([
      expect.closeTo(0.00004096, 12),
      expect.closeTo(0.00000002, 12),
    ])
    for (const [scope] of mocks.accept.mock.calls)
      expect(scope).toMatchObject({
        actorUserId: 'member-1',
        workspaceId: 'workspace-1',
        purpose: 'embedding',
        funding: 'account',
      })
  })

  it.each([429, 500, 'network'] as const)(
    'retries %s through the native SDK and accounts the recovered batch once',
    async (failure) => {
      vi.useFakeTimers()
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          data: [{ embedding: [1, 2], index: 0 }],
          usage: { prompt_tokens: 7, total_tokens: 7 },
        })
      )
      if (failure === 'network')
        fetch.mockRejectedValueOnce(
          new TypeError('fetch failed', {
            cause: Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }),
          })
        )
      else
        fetch.mockResolvedValueOnce(
          Response.json(
            { error: { message: 'Retry later' } },
            {
              status: failure,
              headers: { 'retry-after': '0' },
            }
          )
        )
      vi.stubGlobal('fetch', fetch)
      const result = expect(
        generateEmbeddings(['hello'], { actorUserId: 'member-1' })
      ).resolves.toMatchObject({
        embeddings: [[1, 2]],
        tokens: { prompt: 7, total: 7 },
        usage: { status: 'reported', batches: 1 },
        cost: { total: expect.closeTo(0.00000014, 12) },
      })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
      await vi.runAllTimersAsync()
      await result
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(mocks.order).toEqual(['admit', 'begin', 'accept'])
      expect(mocks.accept).toHaveBeenCalledOnce()
      expect(mocks.accept.mock.calls[0][3]).toBe(mocks.begin.mock.calls[0][1])
    }
  )

  it.each([
    { status: 401, completed: 0, attempts: 1 },
    { status: 429, completed: 0, attempts: 3 },
    { status: 500, completed: 2048, attempts: 4 },
  ])(
    'retains completed usage after HTTP $status fails with $attempts total contacts',
    async ({ status, completed, attempts }) => {
      const fetch = vi.fn(async () =>
        Response.json(
          { error: { message: 'Provider failed' } },
          {
            status,
            headers: { 'retry-after': '0' },
          }
        )
      )
      if (completed)
        fetch.mockResolvedValueOnce(
          Response.json({
            data: Array.from({ length: completed }, (_, index) => ({ embedding: [index], index })),
            usage: { prompt_tokens: completed, total_tokens: completed },
          })
        )
      vi.stubGlobal('fetch', fetch)
      await expect(
        generateEmbeddings(Array(completed + 1).fill('hello'), { actorUserId: 'member-1' })
      ).rejects.toMatchObject({
        tokens: completed ? { prompt: completed, total: completed } : {},
        embeddingUsage: {
          status: completed ? 'partial' : 'unavailable',
          batches: completed ? 1 : 0,
        },
        cost: { status: completed ? 'partial' : 'unavailable' },
        completedEmbeddings: completed
          ? Array.from({ length: completed }, (_, index) => [index])
          : [],
      })
      expect(fetch).toHaveBeenCalledTimes(attempts)
      expect(mocks.begin).toHaveBeenCalledTimes(completed ? 2 : 1)
      expect(mocks.accept).toHaveBeenCalledTimes(completed ? 1 : 0)
    }
  )

  it('cancels during native retry backoff without another contact or fabricated usage', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { message: 'Retry later' } },
        {
          status: 429,
          headers: { 'retry-after': '60' },
        }
      )
    )
    vi.stubGlobal('fetch', fetch)
    const result = expect(
      generateEmbeddings(['hello'], { actorUserId: 'member-1', signal: controller.signal })
    ).rejects.toMatchObject({
      tokens: {},
      embeddingUsage: { status: 'unavailable', batches: 0 },
      cost: { status: 'unavailable' },
    })
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBeGreaterThan(0)
    })
    controller.abort()
    await vi.runAllTimersAsync()
    await result
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.accept).not.toHaveBeenCalled()
  })
})

it('uses each request-owned credential and actual abort signal without changing accepted input bytes', async () => {
  const original = process.env.OPENAI_API_KEY
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
  const one = await generateSearchEmbedding(long, {
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
  expect(one.embedding).toEqual([0, 1])
  expect(one.tokens).toEqual({})
  expect(two.tokens).toEqual({})
  expect(one.usage).toEqual({ status: 'unavailable', batches: 1 })
  expect(one.cost).toMatchObject({ status: 'unavailable', accountCost: null })
  expect(two.cost).toMatchObject({ accountCost: null })
  expect(mocks.accept.mock.calls.every(([scope]) => scope.funding === 'byok')).toBe(true)
  expect(managedServices.readConfig).not.toHaveBeenCalled()
  expect(process.env.OPENAI_API_KEY).toBe(original)
  expect(JSON.stringify([mocks.begin.mock.calls, mocks.accept.mock.calls])).not.toMatch(
    /first-key|second-key|apiKey/
  )
  expect(fetch).toHaveBeenCalledTimes(2)
})
