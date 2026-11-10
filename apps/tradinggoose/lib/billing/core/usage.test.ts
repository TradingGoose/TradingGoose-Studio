/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  lock: vi.fn(),
  insert: vi.fn(),
  settings: vi.fn(),
  effective: vi.fn(),
  editable: vi.fn(),
  minimum: vi.fn(),
  configured: vi.fn(),
}))
const query = () => ({
  from() {
    return this
  },
  where() {
    return this
  },
  limit: async () => mocks.rows,
})
const store = {
  select: vi.fn(query),
  update: vi.fn(() => ({
    set: (value: Record<string, unknown>) => {
      mocks.updates.push(value)
      return { where: vi.fn(async () => []) }
    },
  })),
  insert: mocks.insert,
  transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(store)),
}
vi.mock('@tradinggoose/db', () => ({ db: store }))
vi.mock('@tradinggoose/db/schema', () => ({
  idempotencyKey: { namespace: 'namespace', key: 'key' },
  member: {},
  user: {},
  userStats: {
    id: 'id',
    userId: 'userId',
    currentPeriodCost: 'current',
    totalCost: 'total',
    lastPeriodCost: 'prior',
  },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@tradinggoose/billing', () => ({
  FinancialPolicyError: Error,
  financialNamespace: () => 'billing-usage:user:actor',
  lockFinancialRoots: mocks.lock,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getEffectiveSubscription: mocks.effective,
  getPersonalEffectiveSubscription: mocks.effective,
  getSubscribedPersonalUsageMinimumLimit: mocks.minimum,
  getConfiguredPersonalUsageLimit: mocks.configured,
}))
vi.mock('@/lib/billing/settings', () => ({ getResolvedBillingSettings: mocks.settings }))
vi.mock('@/lib/billing/subscriptions/utils', () => ({ canEditUsageLimit: mocks.editable }))
vi.mock('@/lib/billing/tiers', () => ({ toBillingTierSummary: (tier: unknown) => tier }))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))

describe('exact usage readers and explicit limit mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates.length = 0
    mocks.rows = [
      {
        currentPeriodCost: '0.30000000000000001',
        lastPeriodCost: '0.1',
        totalCost: '0.40000000000000001',
        grantedOnboardingAllowanceUsd: '0',
        customUsageLimit: '0.3',
        customUsageLimitUpdatedAt: null,
      },
    ]
    mocks.settings.mockResolvedValue({ billingEnabled: true, usageWarningThresholdPercent: 80 })
    mocks.effective.mockResolvedValue({ tier: { id: 'tier' }, periodStart: null, periodEnd: null })
    mocks.minimum.mockReturnValue('0.3')
    mocks.configured.mockReturnValue('0.3')
    mocks.editable.mockReturnValue(true)
  })
  it('returns exact committed strings and derives exceeded state before display rounding', async () => {
    const { getUserUsageData } = await import('./usage')
    const result = await getUserUsageData('actor')
    expect(result.currentUsage).toBe('0.30000000000000001')
    expect(result.limit).toBe('0.3')
    expect(result.isExceeded).toBe(true)
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('keeps disabled billing unlimited without a numeric money sentinel', async () => {
    mocks.settings.mockResolvedValue({ billingEnabled: false, usageWarningThresholdPercent: 80 })
    const { getUserUsageData } = await import('./usage')
    const result = await getUserUsageData('actor')
    expect(result.currentUsage).toBe('0.40000000000000001')
    expect(result.limit).toBeNull()
    expect(result.isExceeded).toBe(false)
  })
  it('never repairs a missing ledger while reading', async () => {
    mocks.rows = []
    const { getUserUsageData } = await import('./usage')
    await expect(getUserUsageData('actor')).rejects.toThrow('ledger is missing')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('reads exact committed current-period money directly without provisioning', async () => {
    mocks.rows = [{ current: '0.30000000000000001' }]
    const { getEffectiveCurrentPeriodCost } = await import('./usage')
    expect(await getEffectiveCurrentPeriodCost('actor')).toBe('0.30000000000000001')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.updates).toEqual([])
  })
  it('refuses missing personal current-period ledger without repair', async () => {
    mocks.rows = []
    const { getEffectiveCurrentPeriodCost } = await import('./usage')
    await expect(getEffectiveCurrentPeriodCost('actor')).rejects.toThrow('ledger is missing')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.updates).toEqual([])
  })
  it('refuses a limit below exact committed usage under the original root lock', async () => {
    const { updateUserUsageLimit } = await import('./usage')
    expect(await updateUserUsageLimit('actor', '0.3')).toEqual({
      success: false,
      error: 'Usage limit cannot be below current usage of $0.30000000000000001',
    })
    expect(mocks.lock).toHaveBeenCalledWith(store, [{ type: 'user', id: 'actor' }])
    expect(mocks.updates).toEqual([])
  })
  it('preserves an exact allowed limit without changing grant or monetary slots', async () => {
    const { updateUserUsageLimit } = await import('./usage')
    expect(await updateUserUsageLimit('actor', '0.30000000000000002')).toEqual({ success: true })
    expect(mocks.updates).toEqual([
      { customUsageLimit: '0.30000000000000002', customUsageLimitUpdatedAt: expect.any(Date) },
    ])
  })
  it('rejects monetary-number ingress rather than coercing it', async () => {
    const { updateUserUsageLimit } = await import('./usage')
    expect((await updateUserUsageLimit('actor', 0.3 as unknown as string)).success).toBe(false)
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.updates).toEqual([])
  })
})
