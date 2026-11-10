/** @vitest-environment node */
import {
  member,
  organization,
  organizationMemberBillingLedger,
  subscription,
  userStats,
} from '@tradinggoose/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingTierRecord, SubscriptionWithTier } from '@/lib/billing/tiers'
import type { UsageData } from '@/lib/billing/types'
import { getBillingTierPricing, getSimplifiedBillingSummary } from './billing'

const state = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  select: vi.fn(),
  ledger: vi.fn(),
  personal: vi.fn(),
  usage: vi.fn(),
  settings: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { select: state.select } }))
vi.mock('@/lib/billing/core/organization', () => ({ getOrganizationBillingLedger: state.ledger }))
vi.mock('@/lib/billing/core/subscription', () => ({ getEffectiveSubscription: state.personal }))
vi.mock('@/lib/billing/core/usage', () => ({ getUserUsageData: state.usage }))
vi.mock('@/lib/billing/settings', () => ({ getResolvedBillingSettings: state.settings }))
vi.mock('@/lib/billing/tiers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/tiers')>()),
  hydrateSubscriptionsWithTiers: async (rows: unknown[]) => rows,
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}))

function tier(overrides: Partial<BillingTierRecord> = {}): BillingTierRecord {
  return {
    id: 'tier',
    displayName: 'Tier',
    description: '',
    accessCode: null,
    status: 'active',
    ownerType: 'user',
    usageScope: 'individual',
    seatMode: 'fixed',
    monthlyPriceUsd: '0.1',
    yearlyPriceUsd: null,
    includedUsageLimitUsd: '0.3',
    storageLimitGb: null,
    concurrencyLimit: null,
    workflowExecutionTimeLimitSeconds: null,
    seatCount: null,
    seatMaximum: null,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    stripeProductId: null,
    syncRateLimitPerMinute: null,
    asyncRateLimitPerMinute: null,
    apiEndpointRateLimitPerMinute: null,
    maxPendingAgeSeconds: null,
    maxPendingCount: null,
    canEditUsageLimit: false,
    canConfigureSso: false,
    logRetentionDays: null,
    workflowExecutionMultiplier: '1',
    workflowModelCostMultiplier: '1',
    functionExecutionMultiplier: '1',
    copilotCostMultiplier: '1',
    pricingFeatures: [],
    isPublic: true,
    isDefault: false,
    displayOrder: 0,
    updatedByUserId: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  }
}
function subscribed(
  value = tier(),
  overrides: Partial<SubscriptionWithTier> = {}
): SubscriptionWithTier {
  return {
    id: 'subscription',
    plan: value.id,
    billingTierId: value.id,
    referenceType: value.ownerType,
    referenceId: value.ownerType === 'organization' ? 'org' : 'actor',
    stripeCustomerId: 'customer',
    stripeSubscriptionId: 'stripe-subscription',
    status: 'active',
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-12-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    seats: 1,
    trialStart: null,
    trialEnd: null,
    metadata: null,
    tier: value,
    ...overrides,
  }
}
function usage(overrides: Partial<UsageData> = {}): UsageData {
  return {
    currentUsage: '0.1',
    limit: '0.3',
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    lastPeriodCost: '0.02',
    ...overrides,
  }
}
function organizationFixture(scope: 'pooled' | 'individual' = 'pooled') {
  const selected = subscribed(
    tier({
      ownerType: 'organization',
      usageScope: scope,
      seatMode: 'adjustable',
      includedUsageLimitUsd: '0.1',
    }),
    { seats: 3 }
  )
  state.rows.set(subscription, [selected])
  state.rows.set(member, [{ userId: 'active-member' }])
  state.rows.set(organization, [{ orgUsageLimit: null }])
  return selected
}
beforeEach(() => {
  vi.clearAllMocks()
  state.rows.clear()
  state.rows.set(userStats, [{ currentPeriodCopilotCost: '0.01', lastPeriodCopilotCost: '0.02' }])
  state.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = state.rows.get(table) ?? []
        const promise = Promise.resolve(rows)
        return { limit: async () => rows, then: promise.then.bind(promise) }
      },
    }),
  }))
  state.settings.mockResolvedValue({ billingEnabled: true, usageWarningThresholdPercent: 80 })
  state.personal.mockResolvedValue(subscribed())
  state.usage.mockResolvedValue(usage())
  state.ledger.mockResolvedValue({
    currentPeriodCost: '0.3',
    currentPeriodCopilotCost: '0.01',
    lastPeriodCost: '0.02',
    lastPeriodCopilotCost: '0.01',
  })
})

describe('exact billing read projections', () => {
  it('returns canonical string prices and multiplies only integer seat quantities', () => {
    expect(getBillingTierPricing(tier())).toEqual({ basePrice: '0.1', usageAllowance: '0.3' })
    expect(getBillingTierPricing(organizationFixture())).toEqual({
      basePrice: '0.1',
      usageAllowance: '0.3',
    })
  })
  it('preserves unknown actual tier price independently of configured included credit', () => {
    expect(getBillingTierPricing(tier({ monthlyPriceUsd: null }))).toEqual({
      basePrice: null,
      usageAllowance: '0.3',
    })
    expect(
      getBillingTierPricing(tier({ monthlyPriceUsd: '0', includedUsageLimitUsd: null }))
    ).toEqual({
      basePrice: '0',
      usageAllowance: '0',
    })
  })
  it('preserves personal usage and overage when an actual subscription price is unavailable', async () => {
    state.personal.mockResolvedValue(subscribed(tier({ monthlyPriceUsd: null })))
    state.usage.mockResolvedValue(usage({ currentUsage: '0.30000000000000001' }))
    expect(await getSimplifiedBillingSummary('actor')).toMatchObject({
      basePrice: null,
      currentUsage: '0.30000000000000001',
      overageAmount: '0.00000000000000001',
      totalProjected: null,
    })
  })
  it('preserves unavailable organization seat price without hiding known overage', async () => {
    const selected = organizationFixture()
    state.rows.set(subscription, [
      { ...selected, tier: { ...selected.tier, monthlyPriceUsd: null } },
    ])
    state.ledger.mockResolvedValue({
      currentPeriodCost: '0.4',
      currentPeriodCopilotCost: '0',
      lastPeriodCost: '0',
      lastPeriodCopilotCost: '0',
    })
    expect(await getSimplifiedBillingSummary('actor', 'org')).toMatchObject({
      basePrice: null,
      currentUsage: '0.4',
      overageAmount: '0.1',
      totalProjected: null,
      organizationData: { totalBasePrice: null, totalCurrentUsage: '0.4', totalOverage: '0.1' },
    })
  })
  it.each([
    ['0.29999999999999999', true, false, '0', '0.1'],
    ['0.3', false, true, '0', '0.1'],
    ['0.30000000000000001', false, true, '0.00000000000000001', '0.10000000000000001'],
  ] as const)(
    'keeps exact flags and overage when the display rounds to100 (%s)',
    async (currentUsage, isWarning, isExceeded, overageAmount, totalProjected) => {
      state.usage.mockResolvedValue(usage({ currentUsage }))
      const result = await getSimplifiedBillingSummary('actor')
      expect(result).toMatchObject({
        currentUsage,
        percentUsed: 100,
        isWarning,
        isExceeded,
        overageAmount,
        totalProjected,
      })
      expect(result.usage).toMatchObject({
        current: currentUsage,
        isWarning,
        isExceeded,
        limit: '0.3',
      })
    }
  )
  it.each([0.3, 'NaN', null])(
    'rejects malformed/numeric monetary ingress (%s)',
    async (currentUsage) => {
      state.usage.mockResolvedValue({ ...usage(), currentUsage })
      await expect(getSimplifiedBillingSummary('actor')).rejects.toThrow('decimal strings')
    }
  )
  it('retains actual usage and null unlimited caps when billing is disabled', async () => {
    state.settings.mockResolvedValue({ billingEnabled: false, usageWarningThresholdPercent: 80 })
    state.usage.mockResolvedValue(usage({ currentUsage: '2.12345678900000001', limit: '0.3' }))
    expect(await getSimplifiedBillingSummary('actor')).toMatchObject({
      id: null,
      basePrice: '0',
      currentUsage: '2.12345678900000001',
      overageAmount: '0',
      totalProjected: '0',
      usageLimit: null,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      usage: {
        current: '2.12345678900000001',
        limit: null,
        lastPeriodCost: '0.02',
        copilotCost: '0.01',
      },
    })
  })
  it('does not synthesize a missing billed personal ledger or restore entitlement on reads', async () => {
    state.rows.set(userStats, [])
    await expect(getSimplifiedBillingSummary('actor')).rejects.toThrow(
      'Original personal ledger is missing'
    )
    state.personal.mockResolvedValue(null)
    await expect(getSimplifiedBillingSummary('actor')).rejects.toThrow(
      'No active personal subscription'
    )
  })
  it('preserves pooled exact usage, seat multiplication and original subscription identity', async () => {
    const selected = organizationFixture()
    state.ledger.mockResolvedValue({
      currentPeriodCost: '0.30000000000000001',
      currentPeriodCopilotCost: '0.01',
      lastPeriodCost: '0.02',
      lastPeriodCopilotCost: '0.01',
    })
    expect(await getSimplifiedBillingSummary('actor', 'org')).toMatchObject({
      id: selected.id,
      stripeSubscriptionId: selected.stripeSubscriptionId,
      seats: 3,
      basePrice: '0.3',
      currentUsage: '0.30000000000000001',
      usageLimit: '0.3',
      overageAmount: '0.00000000000000001',
      totalProjected: '0.30000000000000001',
      isExceeded: true,
    })
  })
  it('uses an exact configured cap without allowing display rounding to decide exceeded', async () => {
    organizationFixture()
    state.rows.set(organization, [{ orgUsageLimit: '0.30000000000000002' }])
    state.ledger.mockResolvedValue({
      currentPeriodCost: '0.30000000000000001',
      currentPeriodCopilotCost: '0',
      lastPeriodCost: '0',
      lastPeriodCopilotCost: '0',
    })
    expect(await getSimplifiedBillingSummary('actor', 'org')).toMatchObject({
      usageLimit: '0.30000000000000002',
      percentUsed: 100,
      isWarning: true,
      isExceeded: false,
    })
    state.rows.set(organization, [{ orgUsageLimit: '0.29999999999999999' }])
    expect(await getSimplifiedBillingSummary('actor', 'org')).toMatchObject({
      usageLimit: '0.3',
      isWarning: false,
      isExceeded: true,
    })
  })
  it('includes retained departed-member usage and sums per-member excess without pooled offsets', async () => {
    organizationFixture('individual')
    state.rows.set(organizationMemberBillingLedger, [
      { currentPeriodCost: '0.4' },
      { currentPeriodCost: '0.05' },
      { currentPeriodCost: '0.10000000000000001' },
    ])
    expect(await getSimplifiedBillingSummary('actor', 'org')).toMatchObject({
      currentUsage: '0.55000000000000001',
      overageAmount: '0.30000000000000001',
      totalProjected: '0.60000000000000001',
      organizationData: { memberCount: 1, seatCount: 3, totalCurrentUsage: '0.55000000000000001' },
    })
  })
  it('does not replace a missing billed organization ledger with zero', async () => {
    organizationFixture()
    state.ledger.mockResolvedValue(null)
    await expect(getSimplifiedBillingSummary('actor', 'org')).rejects.toThrow(
      'No billing ledger found'
    )
  })
  it('represents a globally disabled unprovisioned summary with null unlimited limits', async () => {
    state.settings.mockResolvedValue({ billingEnabled: false, usageWarningThresholdPercent: 80 })
    expect(await getSimplifiedBillingSummary('actor', 'org')).toMatchObject({
      basePrice: '0',
      usageLimit: null,
      usage: { limit: null },
      isExceeded: false,
    })
  })
  it('does not require financial entitlement data for a disabled personal summary', async () => {
    state.settings.mockResolvedValue({ billingEnabled: false, usageWarningThresholdPercent: 80 })
    state.personal.mockResolvedValue(null)
    expect(await getSimplifiedBillingSummary('actor')).toMatchObject({
      id: null,
      basePrice: '0',
      currentUsage: '0.1',
      overageAmount: '0',
      totalProjected: '0',
      usageLimit: null,
    })
  })
})
