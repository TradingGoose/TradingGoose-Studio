/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import { getUserLimits } from '@/app/api/v1/logs/meta'

const {
  mockFetch,
  mockSelect,
  mockSelectLimit,
  mockSelectQueue,
  mockUpdate,
  mockUpdateReturning,
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
  const mockTaskTrigger = vi.fn()

  return {
    mockFetch,
    mockSelect,
    mockSelectLimit,
    mockSelectQueue,
    mockUpdate,
    mockUpdateReturning,
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
  tasks: { trigger: mockTaskTrigger },
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

vi.mock('@/app/api/v1/logs/meta', () => ({ getUserLimits: vi.fn() }))

const workflowSummary = {
  id: 'deleted-workflow-1',
  name: 'Deleted Workflow',
  userId: 'user-1',
}

const buildLogRow = (executionData: Record<string, unknown>) => ({
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
  cost: { total: 0.01 },
  files: null,
  createdAt: new Date('2026-04-23T00:01:00.000Z'),
})

describe('logsWebhookDelivery task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockImplementation(async () => new Response('ok'))
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

  afterEach(() => vi.useRealTimers())

  it('bounds response capture and cancels the unread stream', async () => {
    const cancel = vi.fn()
    mockFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('😀'.repeat(2000)))
          },
          cancel,
        })
      )
    )
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
    await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })
    expect(cancel).toHaveBeenCalledOnce()
    const saved = mockUpdate.mock.results.at(-1)!.value.set.mock.calls[0][0]
    expect(saved.responseBody).toBe('😀'.repeat(500))
  })

  it.each([
    [200, 'read'],
    [400, 'read'],
    [503, 'read'],
    [200, 'cancel'],
    [400, 'cancel'],
    [503, 'cancel'],
  ] as const)('preserves HTTP %s policy when diagnostic body %s fails', async (status, failure) => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            if (failure === 'read') controller.error(new Error('Diagnostic body read failed'))
            else controller.enqueue(new TextEncoder().encode('x'.repeat(1000)))
          },
          cancel() {
            throw new Error('Diagnostic body cancellation failed')
          },
        }),
        { status }
      )
    )
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
    const result = await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })
    expect(result).toEqual(
      status === 200
        ? { success: true }
        : { success: false, ...(status === 503 && { retrying: true }) }
    )
    const saved = mockUpdate.mock.results.at(-1)!.value.set.mock.calls[0][0]
    expect(saved).toMatchObject({
      status: status === 200 ? 'success' : status === 503 ? 'pending' : 'failed',
      responseStatus: status,
      responseBody: failure === 'cancel' ? 'x'.repeat(1000) : '',
      failureReason:
        status === 200 ? null : `HTTP ${status}${status === 503 ? ' - will retry' : ''}`,
    })
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockTaskTrigger).toHaveBeenCalledTimes(status === 503 ? 1 : 0)
  })

  it.each([503, 'network'] as const)(
    'schedules %s retry without waiting in the current worker',
    async (failure) => {
      if (failure === 'network') mockFetch.mockRejectedValueOnce(new Error('Network failure'))
      else mockFetch.mockResolvedValueOnce(new Response('Try later', { status: failure }))
      const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
      await expect(executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })).resolves.toMatchObject(
        { retrying: true }
      )
      expect(mockTaskTrigger).toHaveBeenCalledExactlyOnceWith(
        'logs-webhook-delivery',
        { deliveryId: 'delivery-1' },
        { delay: expect.any(Date) }
      )
    }
  )

  it('does not schedule another delivery after native cancellation', async () => {
    const controller = new AbortController()
    mockFetch.mockImplementationOnce(async (_url, init: RequestInit) => {
      controller.abort(new Error('Native task cancelled'))
      init.signal!.throwIfAborted()
    })
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
    await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' }, controller.signal)
    expect(mockTaskTrigger).not.toHaveBeenCalled()
    const saved = mockUpdate.mock.results.at(-1)!.value.set.mock.calls[0][0]
    expect(saved.status).toBe('failed')
  })

  it.each(['deadline', 'cancellation'] as const)(
    'cleans up a stalled diagnostic body after %s without retrying delivery',
    async (interruption) => {
      vi.useFakeTimers()
      const controller = new AbortController()
      mockFetch.mockImplementationOnce(
        async (_url, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal!.addEventListener('abort', () =>
                  controller.error(new DOMException('Timed out', 'AbortError'))
                )
              },
            })
          )
      )
      const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
      const delivery = executeLogsWebhookDelivery({ deliveryId: 'delivery-1' }, controller.signal)
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())
      if (interruption === 'cancellation') controller.abort(new Error('Native task cancelled'))
      else await vi.advanceTimersByTimeAsync(30_000)
      await expect(delivery).resolves.toMatchObject({ success: interruption === 'deadline' })
      const saved = mockUpdate.mock.results.at(-1)!.value.set.mock.calls[0][0]
      expect(saved.status).toBe(interruption === 'deadline' ? 'success' : 'failed')
      expect(mockTaskTrigger).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('uses the stored subscription snapshot and log row before sending the webhook', async () => {
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')

    await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })

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
          endedAt: '2026-04-23T00:01:00.000Z',
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
    expect(request.headers).toMatchObject({ 'Idempotency-Key': 'delivery-1' })
    expect(mockTaskTrigger).not.toHaveBeenCalled()
  })

  it.each([
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ])(
    'honors the rate limits=%s and usage=%s snapshot flags',
    async (includeRateLimits, includeUsageData) => {
      const [delivery] = await mockUpdateReturning()
      Object.assign(delivery.subscriptionSnapshot, { includeRateLimits, includeUsageData })
      const resetAt = '2026-04-23T00:02:00.000Z'
      const executionRateLimit = {
        sync: { limit: 10, remaining: 9, resetAt },
        async: { limit: 20, remaining: 18, resetAt },
      }
      const usage = {
        currentPeriodCost: 5,
        limit: 25,
        tier: EMPTY_BILLING_TIER_SUMMARY,
        isExceeded: false,
      }
      vi.mocked(getUserLimits).mockResolvedValue({ executionRateLimit, usage })
      const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
      await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })
      const { data } = JSON.parse(String(mockFetch.mock.calls[0][1].body))
      expect(data.rateLimits).toEqual(includeRateLimits ? executionRateLimit : undefined)
      expect(data.usage).toEqual(includeUsageData ? usage : undefined)
      if (includeRateLimits || includeUsageData)
        expect(getUserLimits).toHaveBeenCalledExactlyOnceWith(workflowSummary.userId)
      else expect(getUserLimits).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
    ['null', null],
  ])('includes %s finalOutput values when opted in', async (_label, finalOutput) => {
    mockSelectQueue.length = 0
    mockSelectQueue.push([buildLogRow({ finalOutput })])
    mockSelectQueue.push([{ status: 'in_progress' }])
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')

    await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })

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
      const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')
      await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })
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
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')

    const result = await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })

    expect(result).toEqual({ success: false })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('skips the outbound request when the delivery is cancelled after claim', async () => {
    mockSelectQueue.length = 0
    mockSelectQueue.push([buildLogRow({ finalOutput: { orderId: 'order-1' } })])
    mockSelectQueue.push([{ status: 'cancelled' }])
    const { executeLogsWebhookDelivery } = await import('./logs-webhook-delivery')

    const result = await executeLogsWebhookDelivery({ deliveryId: 'delivery-1' })

    expect(result).toEqual({ success: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
