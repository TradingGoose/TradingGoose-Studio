import {
  type FinancialBinding,
  financialFingerprint,
  type ModelOccurrence,
  type OperationReceipt,
  occurrenceKey,
} from '@tradinggoose/billing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  accept: vi.fn(),
}))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: async (input: unknown) => {
    mocks.order.push('create')
    const value = input as FinancialBinding & { operationKey: string }
    return {
      ...value,
      namespace: `billing-usage:user:${value.actorUserId}`,
      key: `invocation:${value.operationKey}`,
      fingerprint: 'bound',
      workspaceId: value.workspaceId ?? null,
      workflowId: value.workflowId ?? null,
    }
  },
  admitFinancialModelStep: async (_binding: unknown, occurrence: { stepNumber: number }) => {
    mocks.order.push(`admit:${occurrence.stepNumber}`)
  },
  acceptFinancialModelStep: mocks.accept,
}))
vi.mock('@/lib/mastra/connections', () => ({
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
import { getInferenceFacts } from '@/lib/mastra/result'

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
  mocks.order.length = 0
  vi.clearAllMocks()
  mocks.accept.mockImplementation(async (_binding, occurrence) => {
    mocks.order.push(`accept:${occurrence.stepNumber}`)
    return acceptedReceipt(_binding, occurrence)
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
    expect(result.cost).toEqual({ status: 'unavailable' })
    expect(mocks.order).toEqual([
      'create',
      'admit:0',
      'http',
      'accept:0',
      'admit:1',
      'http',
      'accept:1',
    ])
    expect(mocks.accept.mock.calls.map((call) => call[1].usage)).toEqual([
      { inputTokens: 2048, totalTokens: 2048 },
      { inputTokens: 1, totalTokens: 1 },
    ])
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
      expect(mocks.order).toEqual(['create', 'admit:0'])
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
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('uses actual installed native transport only after both trusted-source checks and retains its facts', async () => {
  const order: string[] = []
  const verifySource = vi.fn(async () => {
    order.push('source')
  })
  const fetcher = vi.fn(async () => {
    order.push('http')
    return Response.json({
      object: 'list',
      model: 'embedding',
      data: [{ object: 'embedding', embedding: [0.25, 0.5], index: 0 }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const result = await generateEmbeddings(['hello'], {
    actorUserId: 'member-1',
    runId: 'owned-native-docs-child',
    verifySource,
    expectedNamespace: 'billing-usage:user:member-1',
  })
  expect(order).toEqual(['source', 'source', 'http'])
  expect(mocks.order).toEqual(['create', 'admit:0', 'create', 'accept:0'])
  expect(getInferenceFacts(result)).toMatchObject({
    tokens: { prompt: 2, total: 2 },
    embeddingUsage: { status: 'reported', batches: 1 },
  })
  expect(fetcher).toHaveBeenCalledOnce()
})
it('refuses a changed Pending source after native admission with zero installed transport contacts', async () => {
  const verifySource = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Pending changed'))
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    generateEmbeddings(['hello'], {
      actorUserId: 'member-1',
      runId: 'owned-native-docs-denied',
      verifySource,
    })
  ).rejects.toThrow('Pending changed')
  expect(mocks.order).toEqual(['create', 'admit:0'])
  expect(fetcher).not.toHaveBeenCalled()
  expect(mocks.accept).not.toHaveBeenCalled()
})
