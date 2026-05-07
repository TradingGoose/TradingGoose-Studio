/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetch,
  mockSelect,
  mockSelectLimit,
  mockSelectQueue,
  mockUpdate,
  mockUpdateReturning,
  mockWaitFor,
  mockTaskTrigger,
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

  return {
    mockFetch,
    mockSelect,
    mockSelectLimit,
    mockSelectQueue,
    mockUpdate,
    mockUpdateReturning,
    mockWaitFor,
    mockTaskTrigger,
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

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: 'sql',
    values,
  })),
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

const buildLogRow = (executionData: Record<string, unknown>) => ({
  id: 'log-1',
  workflowId: null,
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  stateSnapshotId: 'snapshot-1',
  level: 'info',
  trigger: 'manual',
  startedAt: new Date('2026-04-23T00:00:00.000Z'),
  endedAt: new Date('2026-04-23T00:01:00.000Z'),
  totalDurationMs: 60_000,
  executionData,
  cost: { total: 0.01 },
  files: null,
  createdAt: new Date('2026-04-23T00:01:00.000Z'),
})

describe('logsWebhookDelivery task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      }),
    ])
  })

  it('uses the stored subscription snapshot and log row before sending the webhook', async () => {
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')

    await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })

    expect(mockUpdateReturning).toHaveBeenCalledTimes(1)
    expect(mockSelect).toHaveBeenCalledTimes(1)
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
    const { logsWebhookDelivery } = await import('./logs-webhook-delivery')

    await (logsWebhookDelivery as any).run({ deliveryId: 'delivery-1' })

    const request = mockFetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.data).toHaveProperty('finalOutput', finalOutput)
  })

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
})
