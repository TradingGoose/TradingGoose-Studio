import { describe, expect, it } from 'vitest'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import {
  createWorkflowExecutionDeadlineResult,
  createWorkflowExecutionTimePolicy,
  getWorkflowExecutionTimeLimitMilliseconds,
  isWorkflowExecutionTimePolicy,
} from './workflow-execution-time-policy'

const tier = (limit: number | null) =>
  ({
    id: 'tier-1',
    displayName: 'Pro',
    workflowExecutionTimeLimitSeconds: limit,
  }) as BillingTierRecord

describe('workflow execution time policy', () => {
  const base = { processingStartedAt: '2026-01-01T00:00:00.000Z' }
  it('preserves missing billing context as tierless unlimited', () => {
    expect(createWorkflowExecutionTimePolicy({ ...base, tier: null })).toEqual({
      kind: 'unlimited',
      ...base,
      tier: { source: 'no-tier' },
    })
  })

  it('preserves a null configured limit as resolved-tier unlimited', () => {
    expect(createWorkflowExecutionTimePolicy({ ...base, tier: tier(null) })).toMatchObject({
      kind: 'unlimited',
      tier: { source: 'resolved-tier', appliedTierId: 'tier-1', appliedTierName: 'Pro' },
    })
  })

  it('converts fractional configured seconds to milliseconds for each attempt', () => {
    const policy = createWorkflowExecutionTimePolicy({ ...base, tier: tier(1.5) })
    expect(policy).toMatchObject({
      kind: 'bounded',
      limitSeconds: 1.5,
      accounting: { mode: 'remaining', remainingMilliseconds: 1_500 },
    })
    expect(getWorkflowExecutionTimeLimitMilliseconds(policy)).toBe(1_500)
  })

  it('creates a clear user-facing deadline error with the captured tier and limit', () => {
    const policy = createWorkflowExecutionTimePolicy({ ...base, tier: tier(1.5) })
    if (policy.kind !== 'bounded') throw new Error('Expected a bounded policy')

    const result = createWorkflowExecutionDeadlineResult(policy, '2026-01-01T00:00:01.500Z', [
      {
        blockId: 'wait-1',
        blockType: 'wait',
        startedAt: base.processingStartedAt,
        endedAt: '2026-01-01T00:00:01.500Z',
        durationMs: 1_500,
        success: false,
        code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      },
    ])
    expect(result).toMatchObject({
      success: false,
      error:
        'Workflow execution stopped because it reached the 1.5-second Workflow Execution Time Limit for the "Pro" tier.',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      deadline: {
        appliedTierName: 'Pro',
        limitSeconds: 1.5,
        terminatedAt: '2026-01-01T00:00:01.500Z',
      },
      logs: [{ error: expect.stringContaining('"Pro" tier') }],
    })
  })

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'rejects invalid configured value %s',
    (limit) => {
      expect(() => createWorkflowExecutionTimePolicy({ ...base, tier: tier(limit) })).toThrow(
        /invalid|unsafe/
      )
    }
  )

  it.each([
    {
      kind: 'bounded',
      ...base,
      tier: { source: 'no-tier' },
      limitSeconds: 10,
      accounting: { mode: 'remaining', remainingMilliseconds: 10_000 },
    },
    {
      kind: 'bounded',
      ...base,
      tier: { source: 'resolved-tier', appliedTierId: 'tier-1', appliedTierName: 'Pro' },
      limitSeconds: 10,
      accounting: { mode: 'remaining', remainingMilliseconds: 10_001 },
    },
    {
      kind: 'bounded',
      ...base,
      tier: { source: 'resolved-tier', appliedTierId: 'tier-1', appliedTierName: 'Pro' },
      limitSeconds: 10,
      accounting: { mode: 'absolute', expiresAt: '2026-01-01T00:00:11.000Z' },
    },
    {
      kind: 'unlimited',
      ...base,
      tier: { source: 'no-tier' },
      limitSeconds: 10,
    },
    {
      kind: 'bounded',
      ...base,
      tier: { source: 'resolved-tier', appliedTierId: 'tier-1', appliedTierName: 'Pro' },
      limitSeconds: 10,
      accounting: { mode: 'garbage', expiresAt: '2026-01-01T00:00:10.000Z' },
    },
    {
      kind: 'bounded',
      ...base,
      tier: { source: 'resolved-tier', appliedTierId: 'tier-1', appliedTierName: 'Pro' },
      limitSeconds: 10,
      accounting: null,
    },
    {
      kind: 'unlimited',
      processingStartedAt: '2026-01-01',
      tier: { source: 'no-tier' },
    },
  ])('rejects contradictory inherited policy %#', (policy) => {
    expect(isWorkflowExecutionTimePolicy(policy)).toBe(false)
  })
})
