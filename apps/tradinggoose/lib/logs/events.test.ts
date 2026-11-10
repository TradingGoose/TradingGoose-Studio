/** @vitest-environment node */

import { FinancialPolicyError } from '@tradinggoose/billing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitWorkflowExecutionCompleted } from './events'

const state = vi.hoisted(() => ({
  subscriptions: [] as any[],
  deliveries: new Map<string, any>(),
  selects: vi.fn(),
  inserts: vi.fn(),
  trigger: vi.fn(),
  verify: vi.fn(),
  errors: vi.fn(),
  readbackFailure: false,
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: (table: string) => ({
        where: (condition: any) => {
          state.selects(table)
          const rows = () =>
            table === 'subscriptions'
              ? state.subscriptions
              : state.readbackFailure
                ? []
                : [state.deliveries.get(condition.value)].filter(Boolean)
          return {
            then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
            limit: async () => rows(),
          }
        },
      }),
    }),
    insert: () => ({
      values: (delivery: any) => ({
        onConflictDoNothing: async () => {
          state.inserts(delivery)
          if (!state.deliveries.has(delivery.id))
            state.deliveries.set(delivery.id, structuredClone(delivery))
        },
      }),
    }),
  },
}))
vi.mock('@tradinggoose/db/schema', () => ({
  workflowLogWebhook: 'subscriptions',
  workflowLogWebhookDelivery: { id: 'delivery.id' },
}))
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (field: unknown, value: unknown) => ({ field, value }),
}))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: state.verify }))
vi.mock('@/background/logs-webhook-delivery', () => ({
  logsWebhookDelivery: { trigger: state.trigger },
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: state.errors }),
}))
const log = () => ({
  id: 'log-1',
  workflowId: null,
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  workflowSummary: { id: 'deleted-workflow-1' },
  level: 'info',
  trigger: 'manual',
  executionData: {
    environment: {
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      workflowId: 'deleted-workflow-1',
    },
    billing: {
      binding: {
        namespace: 'billing-usage:user:actor-1',
        key: 'invocation:execution-1',
        fingerprint: 'original-financial-fingerprint',
        runId: 'execution-1',
        actorUserId: 'actor-1',
        workspaceId: 'workspace-1',
        workflowId: 'deleted-workflow-1',
        purpose: 'workflow-execution',
      },
    },
  },
})
const subscription = (id = 'subscription-1') => ({
  id,
  url: 'https://example.com/webhook',
  secret: 'first-private-secret',
  includeFinalOutput: true,
  includeTraceSpans: false,
  includeRateLimits: false,
  includeUsageData: false,
  levelFilter: null,
  triggerFilter: null,
})
beforeEach(() => {
  vi.clearAllMocks()
  state.deliveries.clear()
  state.subscriptions = [subscription()]
  state.readbackFailure = false
  state.verify.mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
  state.trigger.mockResolvedValue(undefined)
})

describe('verified idempotent workflow completion publication', () => {
  it('queues detached workflow ownership using one deterministic scoped delivery id', async () => {
    await emitWorkflowExecutionCompleted(log())
    const [delivery] = state.deliveries.values()
    expect(delivery).toMatchObject({
      executionId: 'execution-1',
      id: expect.stringMatching(/^completion:[a-f0-9]{64}$/),
      status: 'pending',
      workflowId: 'deleted-workflow-1',
      workspaceId: 'workspace-1',
      attempts: 0,
    })
    expect(state.trigger).toHaveBeenCalledExactlyOnceWith({ deliveryId: delivery.id })
    expect(state.verify).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'workflow-execution' }),
      { stepNumber: 0, retryCount: 0, runId: 'execution-1' }
    )
  })
  it('refuses missing financial acceptance before any optional publication work', async () => {
    state.verify.mockRejectedValueOnce(
      new FinancialPolicyError('Financial acceptance is unresolved')
    )
    await expect(emitWorkflowExecutionCompleted(log())).rejects.toThrow(
      'Financial acceptance is unresolved'
    )
    expect(state.selects).not.toHaveBeenCalled()
    expect(state.inserts).not.toHaveBeenCalled()
    expect(state.trigger).not.toHaveBeenCalled()
  })
  it('retries a lost trigger acknowledgement using the first immutable destination', async () => {
    state.trigger.mockRejectedValueOnce(new Error('Trigger acknowledgement lost'))
    await emitWorkflowExecutionCompleted(log())
    const [first] = state.deliveries.values()
    state.subscriptions = [
      { ...subscription(), url: 'https://changed.invalid', secret: 'new-secret' },
    ]
    await emitWorkflowExecutionCompleted(log())
    expect(state.deliveries.size).toBe(1)
    expect(state.deliveries.get(first.id)).toEqual(first)
    expect(first.subscriptionSnapshot.url).toBe('https://example.com/webhook')
    expect(state.trigger.mock.calls).toEqual([
      [{ deliveryId: first.id }],
      [{ deliveryId: first.id }],
    ])
  })
  it('recovers after insertion followed by missing readback without allocating another identity', async () => {
    state.readbackFailure = true
    await emitWorkflowExecutionCompleted(log())
    expect(state.deliveries.size).toBe(1)
    expect(state.trigger).not.toHaveBeenCalled()
    state.readbackFailure = false
    await emitWorkflowExecutionCompleted(log())
    expect(state.deliveries.size).toBe(1)
    expect(state.trigger).toHaveBeenCalledOnce()
  })
  it.each(['success', 'failed', 'in_progress'])(
    'preserves %s delivery state across completion retries',
    async (status) => {
      await emitWorkflowExecutionCompleted(log())
      state.trigger.mockClear()
      const [delivery] = state.deliveries.values()
      Object.assign(delivery, { status, attempts: 7, nextAttemptAt: null })
      const before = structuredClone(delivery)
      await emitWorkflowExecutionCompleted(log())
      expect(state.deliveries.get(delivery.id)).toEqual(before)
      expect(state.trigger).not.toHaveBeenCalled()
    }
  )
  it('keeps pending backoff and retriggers only when due', async () => {
    await emitWorkflowExecutionCompleted(log())
    state.trigger.mockClear()
    const [delivery] = state.deliveries.values()
    delivery.attempts = 2
    delivery.nextAttemptAt = new Date(Date.now() + 60_000)
    await emitWorkflowExecutionCompleted(log())
    expect(state.trigger).not.toHaveBeenCalled()
    delivery.nextAttemptAt = null
    await emitWorkflowExecutionCompleted(log())
    expect(state.trigger).toHaveBeenCalledExactlyOnceWith({ deliveryId: delivery.id })
    expect(delivery.attempts).toBe(2)
  })
  it('concurrent retries share the same inserted row and contact-guard identity', async () => {
    await Promise.all(Array.from({ length: 20 }, () => emitWorkflowExecutionCompleted(log())))
    expect(state.deliveries.size).toBe(1)
    const ids = new Set(state.trigger.mock.calls.map(([input]) => input.deliveryId))
    expect(ids.size).toBe(1)
    // Trigger contacts are guarded by the worker pending->in_progress CAS, not this queue insert.
    expect(state.trigger).toHaveBeenCalled()
  })
  it('separates log/subscription/workspace scopes while preserving filters', async () => {
    state.subscriptions = [
      subscription(),
      subscription('second'),
      { ...subscription('filtered'), levelFilter: ['error'] },
    ]
    await emitWorkflowExecutionCompleted(log())
    await emitWorkflowExecutionCompleted({ ...log(), id: 'different-log' })
    const another = log()
    another.workspaceId = 'workspace-2'
    another.executionData.environment.workspaceId = 'workspace-2'
    another.executionData.billing.binding.workspaceId = 'workspace-2'
    await emitWorkflowExecutionCompleted(another)
    expect(state.deliveries.size).toBe(6)
    expect(state.trigger).toHaveBeenCalledTimes(6)
  })
})
