import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttemptTimeBudget } from '@/lib/execution/workflow-execution-time-budget'
import type { WorkflowExecutionTimePolicy } from '@/lib/execution/workflow-execution-time-policy'

const remainingPolicy: WorkflowExecutionTimePolicy = {
  kind: 'bounded',
  processingStartedAt: '2026-01-01T00:00:00.000Z',
  tier: { source: 'resolved-tier', appliedTierId: 'tier-1', appliedTierName: 'Pro' },
  limitSeconds: 10,
  accounting: { mode: 'remaining', remainingMilliseconds: 10_000 },
}

describe('AttemptTimeBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => vi.useRealTimers())

  it('expires a bounded attempt at zero', async () => {
    const budget = new AttemptTimeBudget(remainingPolicy, 1_000)
    let expired = false
    void budget.expired.then(() => {
      expired = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(expired).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(expired).toBe(true)
    budget.dispose()
  })

  it('keeps charging while a local sibling is active and pauses when only child wait remains', async () => {
    const budget = new AttemptTimeBudget(remainingPolicy, 10_000)
    budget.registerActivity('virtual-child-0')
    budget.registerActivity('local-sibling')
    budget.markQueuedChildWait('virtual-child-0')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(budget.remainingMilliseconds()).toBe(8_000)

    budget.closeActivity('local-sibling')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(budget.remainingMilliseconds()).toBe(8_000)

    budget.closeActivity('virtual-child-0')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(budget.remainingMilliseconds()).toBe(7_000)
    budget.dispose()
  })

  it('keeps ownership paused through nested child work and adopts the returned allowance', async () => {
    const budget = new AttemptTimeBudget(remainingPolicy, 10_000)
    budget.registerActivity('child')
    budget.markQueuedChildWait('child')

    await vi.advanceTimersByTimeAsync(20_000)
    expect(budget.remainingMilliseconds()).toBe(10_000)

    budget.mergeChildRemaining(4_000)
    expect(budget.remainingMilliseconds()).toBe(4_000)

    budget.closeActivity('child')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(budget.remainingMilliseconds()).toBe(3_000)
    budget.dispose()
  })

  it('snapshots current allowance and merges multiple children monotonically', async () => {
    const budget = new AttemptTimeBudget(remainingPolicy, 10_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(budget.snapshotPolicy()).toMatchObject({
      accounting: { mode: 'remaining', remainingMilliseconds: 9_000 },
    })
    budget.mergeChildRemaining(7_000)
    budget.mergeChildRemaining(8_000)
    expect(budget.remainingMilliseconds()).toBe(7_000)
    budget.mergeChildRemaining(5_000)
    expect(budget.remainingMilliseconds()).toBe(5_000)
    budget.dispose()
  })

  it('does not pause an absolute policy while a child is queued', async () => {
    const absolute: WorkflowExecutionTimePolicy = {
      ...remainingPolicy,
      accounting: { mode: 'absolute', expiresAt: '2026-01-01T00:00:10.000Z' },
    }
    const budget = new AttemptTimeBudget(absolute, 10_000)
    budget.registerActivity('child')
    budget.markQueuedChildWait('child')
    let expired = false
    void budget.expired.then(() => {
      expired = true
    })
    await vi.advanceTimersByTimeAsync(10_000)
    // Absolute mode is represented by a fixed expiry and is never refunded in snapshots.
    expect(budget.snapshotPolicy()).toEqual(absolute)
    expect(expired).toBe(true)
    budget.dispose()
  })

  it('disposes its armed timer', () => {
    const budget = new AttemptTimeBudget(remainingPolicy, 10_000)
    expect(vi.getTimerCount()).toBe(1)
    budget.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
