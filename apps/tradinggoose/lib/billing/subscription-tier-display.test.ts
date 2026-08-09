import { describe, expect, it } from 'vitest'
import type { PublicBillingTierDisplay } from './public-catalog'
import {
  composeSubscriptionTierDisplays,
  type SubscriptionTierDisplay,
} from './subscription-tier-display'
import { EMPTY_BILLING_TIER_SUMMARY } from './tier-summary'

const publicTier = (id: string, displayOrder: number): PublicBillingTierDisplay => ({
  id,
  displayName: id,
  description: '',
  ownerType: 'user',
  seatMode: 'fixed',
  usageScope: 'individual',
  displayOrder,
  monthlyPriceUsd: 0,
  yearlyPriceUsd: null,
  seatCount: null,
  seatMaximum: null,
  canEditUsageLimit: false,
  pricingFeatures: [],
  isDefault: false,
})

const privateTier = (id: string, displayOrder: number): SubscriptionTierDisplay => ({
  ...publicTier(id, displayOrder),
  status: 'active',
  isPublic: false,
  isCurrentOnly: false,
})

describe('composeSubscriptionTierDisplays', () => {
  it('merges, dedupes, and sorts public/private tiers', () => {
    const result = composeSubscriptionTierDisplays({
      publicTiers: [publicTier('b', 2), publicTier('a', 1)],
      privateTiers: [privateTier('b', 2), privateTier('c', 1)],
      currentTier: null,
    })
    expect(result.map((tier) => tier.id)).toEqual(['a', 'c', 'b'])
    expect(result.filter((tier) => tier.id === 'b')).toHaveLength(1)
  })

  it('synthesizes an archived current-only tier', () => {
    const result = composeSubscriptionTierDisplays({
      publicTiers: [],
      privateTiers: [],
      currentTier: {
        ...EMPTY_BILLING_TIER_SUMMARY,
        id: 'archived',
        displayName: 'Archived',
        status: 'archived',
      },
    })
    expect(result).toMatchObject([{ id: 'archived', isCurrentOnly: true, status: 'archived' }])
  })

  it('does not duplicate a selectable current tier', () => {
    const result = composeSubscriptionTierDisplays({
      publicTiers: [publicTier('current', 0)],
      privateTiers: [],
      currentTier: {
        ...EMPTY_BILLING_TIER_SUMMARY,
        id: 'current',
        displayName: 'Current',
        status: 'active',
      },
    })
    expect(result).toHaveLength(1)
    expect(result[0].isCurrentOnly).toBe(false)
  })
})
