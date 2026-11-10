/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => {
      throw new Error('Pure tier helpers cannot read or mutate storage')
    }),
  },
}))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))

import {
  type BillingTierRecord,
  getSubscriptionUsageAllowanceUsd,
  getTierBasePrice,
  getTierIncludedUsageLimit,
  getTierUsageAllowanceUsd,
  toBillingTierSummary,
} from './tiers'

const tier = (patch: Record<string, unknown> = {}) =>
  ({
    id: 'verified-tier',
    monthlyPriceUsd: null,
    yearlyPriceUsd: null,
    includedUsageLimitUsd: null,
    ownerType: 'user',
    workflowExecutionMultiplier: '1',
    workflowModelCostMultiplier: '1',
    functionExecutionMultiplier: '0',
    copilotCostMultiplier: '1',
    ...patch,
  }) as BillingTierRecord

describe('verified tier amounts and unavailable prices', () => {
  it('preserves unavailable display price as null', () => {
    expect(getTierBasePrice(null)).toBeNull()
    expect(getTierBasePrice(tier())).toBeNull()
    expect(getTierBasePrice(tier({ monthlyPriceUsd: '0.30000000000000001' }))).toBe(
      '0.30000000000000001'
    )
  })
  it('uses known zero configured credit only for an actual tier', () => {
    expect(getTierIncludedUsageLimit(tier())).toBe('0')
    expect(() => getTierUsageAllowanceUsd(null)).toThrow('Required billing tier')
    expect(() => getSubscriptionUsageAllowanceUsd(null)).toThrow('Required financial tier')
    expect(() => getTierIncludedUsageLimit(tier({ includedUsageLimitUsd: undefined }))).toThrow()
  })
  it('retains exact seat factors and refuses invalid seat quantities', () => {
    const organization = tier({
      ownerType: 'organization',
      includedUsageLimitUsd: '0.10000000000000001',
    })
    expect(getSubscriptionUsageAllowanceUsd({ tier: organization, seats: 3 })).toBe(
      '0.30000000000000003'
    )
    expect(() => getSubscriptionUsageAllowanceUsd({ tier: organization, seats: 1.5 })).toThrow()
  })
  it('rejects missing or numeric required multipliers instead of replacing them', () => {
    expect(() => toBillingTierSummary(tier({ workflowExecutionMultiplier: undefined }))).toThrow()
    expect(() => toBillingTierSummary(tier({ functionExecutionMultiplier: 0 }))).toThrow()
    expect(toBillingTierSummary(tier()).functionExecutionMultiplier).toBe('0')
  })
})
