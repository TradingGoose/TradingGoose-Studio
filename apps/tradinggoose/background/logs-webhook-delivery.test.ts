/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalLogFixture,
  hydrateCanonicalLogFixture,
} from '@/lib/execution/__test-utils__/canonical-log-fixture'

const {
  mockFetch,
  mockSelect,
  mockSelectLimit,
  mockSelectQueue,
  mockUpdate,
  mockUpdateReturning,
  mockWaitFor,
  mockTaskTrigger,
  mockVerify,
  mockHydrate,
  mockAccess,
} = vi.hoisted(() => {
  const mockFetch = vi.fn()
  const mockSelectQueue: unknown[][] = []
  const mockSelectLimit = vi.fn(() => Promise.resolve(mockSelectQueue.shift() ?? []))
  const mockSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: mockSelectLimit,
      })),
    })),
  }))
  const mockUpdateReturning = vi.fn()
  const mockUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: mockUpdateReturning,
      })),
    })),
  }))
  const mockWaitFor = vi.fn()
  const mockTaskTrigger = vi.fn()
  const mockVerify = vi.fn()
  const mockHydrate = vi.fn()
  const mockAccess = vi.fn()

  return {
    mockFetch,
    mockSelect,
    mockSelectLimit,
    mockSelectQueue,
    mockUpdate,
    mockUpdateReturning,
    mockWaitFor,
    mockTaskTrigger,
    mockVerify,
    mockHydrate,
    mockAccess,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionLogs: {
    createdAt: 'workflowExecutionLogs.createdAt',
    executionId: 'workflowExecutionLogs.executionId',
    id: 'workflowExecutionLogs.id',
    workspaceId: 'workflowExecutionLogs.workspaceId',
  },
  workflowLogWebhookDelivery: {
    attempts: 'workflowLogWebhookDelivery.attempts',
    id: 'workflowLogWebhookDelivery.id',
    nextAttemptAt: 'workflowLogWebhookDelivery.nextAttemptAt',
    status: 'workflowLogWebhookDelivery.status',
  },
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
}))

vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: mockVerify }))
vi.mock('@/lib/workflow-archive/functional', () => ({
  hydrateExecutionPayload: mockHydrate,
  assertRetainedLogAccess: mockAccess,
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config) => ({
    ...config,
    trigger: mockTaskTrigger,
  })),
  wait: {
    for: mockWaitFor,
  },
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'event-1'),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: vi.fn(),
}))

const workflowSummary = {
  id: 'deleted-workflow-1',
  name: 'Deleted Workflow',
  userId: 'user-1',
}

const buildLogRow = (executionData: Record<string, unknown>) =>
  canonicalLogFixture({
    id: 'log-1',
    workflowId: null,
    workflowSummary,
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    stateSnapshotId: 'snapshot-1',
    level: 'info',
    trigger: 'manual',
    startedAt: new Date('2026-04-23T00:00:00.000Z'),
    endedAt: new Date('2026-04-23T00:01:00.000Z'),
    totalDurationMs: 60_000,
    executionData,
    cost: null,
    files: null,
    createdAt: new Date('2026-04-23T00:01:00.000Z'),
  })

describe('logsWebhookDelivery task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerify.mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
    mockHydrate.mockImplementation(hydrateCanonicalLogFixture)
    mockAccess.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    })
    global.fetch = mockFetch as typeof fetch

    mockUpdateReturning.mockResolvedValue([
      {
        id: 'delivery-1',
        attempts: 1,
        executionId: 'execution-1',
        subscriptionId: 'subscription-1',
        workspaceId: 'workspace-1',
        workflowSummary,
        subscriptionSnapshot: {
          url: 'https://example.com/webhook',
          secret: null,
          includeFinalOutput: true,
          includeTraceSpans: false,
          includeRateLimits: false,
          includeUsageData: false,
        },
      },
    ])
    mockSelectQueue.length = 0
    mockSelectQueue.push([
      buildLogRow({
        finalOutput: { orderId: 'order-1' },
        traceSpans: [{ id: 'span-1' }],
        checkpoint: { encryptedSnapshot: 'private-checkpoint-ciphertext', revision: 2 },
        pause: { url: '/review/execution-1', revision: 2 },
      }),
    ])
    mockSelectQueue.push([{ status: 'in_progress' }])
  })

  it('uses the stored subscription snapshot and log row before sending the webhook', async () => {
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')

    await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })

    expect(mockUpdateReturning).toHaveBeenCalledTimes(1)
    expect(mockSelect).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
      })
    )

    const request = mockFetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          executionId: 'execution-1',
          finalOutput: { orderId: 'order-1' },
          workflowId: 'deleted-workflow-1',
        }),
        links: {
          execution: '/v1/logs/executions/execution-1',
          log: '/v1/logs/log-1',
        },
      })
    )
    expect(body.data.traceSpans).toBeUndefined()
    expect(body.data).not.toHaveProperty('checkpoint')
    expect(body.data).not.toHaveProperty('pause')
    expect(String(request.body)).not.toContain('private-checkpoint-ciphertext')
    expect(mockTaskTrigger).not.toHaveBeenCalled()
  })

  it.each([
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
    ['null', null],
  ])('includes %s finalOutput values when opted in', async (_label, finalOutput) => {
    mockSelectQueue.length = 0
    mockSelectQueue.push([buildLogRow({ finalOutput })])
    mockSelectQueue.push([{ status: 'in_progress' }])
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')

    await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })

    const request = mockFetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.data).toHaveProperty('finalOutput', finalOutput)
  })

  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'includes canonical failure details only with output=%s or traces=%s',
    async (includeFinalOutput, includeTraceSpans) => {
      const [delivery] = await mockUpdateReturning()
      Object.assign(delivery.subscriptionSnapshot, { includeFinalOutput, includeTraceSpans })
      mockSelectQueue[0] = [
        {
          ...buildLogRow({
            finalOutput: {},
            traceSpans: [],
            errorMessage: 'Private cancellation reason',
          }),
          level: 'error',
        },
      ]
      const { logsWebhookDelivery } = await import('./logs-webhook-delivery')
      await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })
      const body = JSON.parse(String(mockFetch.mock.calls[0][1].body))
      expect(body.data.status).toBe('error')
      expect(body.data.errorMessage).toBe(
        includeFinalOutput || includeTraceSpans ? 'Private cancellation reason' : undefined
      )
      expect(body.data.finalOutput).toEqual(includeFinalOutput ? {} : undefined)
      expect(body.data.traceSpans).toEqual(includeTraceSpans ? [] : undefined)
    }
  )

  it('fails delivery without fetching when the stored subscription snapshot is missing', async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      {
        id: 'delivery-1',
        attempts: 1,
        executionId: 'execution-1',
        subscriptionId: 'subscription-1',
        workspaceId: 'workspace-1',
        workflowSummary,
        subscriptionSnapshot: null,
      },
    ])
    mockSelectQueue.length = 0
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')

    const result = await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })

    expect(result).toEqual({ success: false })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('skips the outbound request when the delivery is cancelled after claim', async () => {
    mockSelectQueue.length = 0
    mockSelectQueue.push([buildLogRow({ finalOutput: { orderId: 'order-1' } })])
    mockSelectQueue.push([{ status: 'cancelled' }])
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')

    const result = await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })

    expect(result).toEqual({ success: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it.each(['financial', 'canonical', 'revoked', 'scope', 'active'])(
    'refuses outbound delivery when %s proof fails',
    async (kind) => {
      if (kind === 'financial')
        mockVerify.mockRejectedValueOnce(new Error('Original base occurrence unaccepted'))
      if (kind === 'canonical')
        mockHydrate.mockRejectedValueOnce(new Error('Canonical scoped readback unavailable'))
      if (kind === 'revoked')
        mockAccess.mockRejectedValueOnce(new Error('Retained record access revoked'))
      if (kind === 'scope' || kind === 'active') {
        const row = buildLogRow({ finalOutput: { preserved: true } })
        if (kind === 'scope') row.workflowSummary = { id: 'different-workflow' }
        else row.endedAt = null
        mockSelectQueue[0] = [row]
      }
      const { logsWebhookDelivery } = await import('./logs-webhook-delivery')
      const result = await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })
      expect(result).toMatchObject({ success: false, error: expect.any(String) })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockTaskTrigger).not.toHaveBeenCalled()
    }
  )

  it('does not contact the webhook when another task already claimed the delivery', async () => {
    mockUpdateReturning.mockResolvedValueOnce([])
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')
    await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('hydrates canonical tool results and removes internal native references before delivery', async () => {
    const [delivery] = await mockUpdateReturning()
    delivery.subscriptionSnapshot.includeTraceSpans = true
    mockSelectQueue[0] = [
      buildLogRow({
        finalOutput: { answer: 42, cost: 'intentional-schema-value' },
        traceSpans: [
          {
            id: 'span',
            output: { inference: 'schema-owned' },
            inference: { nativePayload: { capability: 'private' } },
          },
        ],
      }),
    ]
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')
    await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body))
    expect(body.data.finalOutput).toEqual({ answer: 42, cost: 'intentional-schema-value' })
    expect(body.data.traceSpans).toEqual([{ id: 'span', output: { inference: 'schema-owned' } }])
    expect(JSON.stringify(body)).not.toContain('workflow-functional-output')
    expect(JSON.stringify(body)).not.toContain('nativePayload')
    expect(mockHydrate).toHaveBeenCalledOnce()
    expect(mockAccess.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
  it('refuses preserved-reference completion without ORIGINAL binding before any outbound effect', async () => {
    mockSelectQueue[0] = [
      buildLogRow({
        preservedFunctionalArchive: { version: 1, purpose: 'workflow-archive' },
        billing: {},
      }),
    ]
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')
    const result = await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Original workflow financial binding'),
    })
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockHydrate).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockTaskTrigger).not.toHaveBeenCalled()
  })
})
