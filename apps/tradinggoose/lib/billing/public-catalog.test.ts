import { describe, expect, it } from 'vitest'
import { type BillingTierDisplay, composeBillingTierDisplays } from './public-catalog'

const publicTier = (id: string, displayOrder: number): BillingTierDisplay => ({
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

const privateTier = (id: string, displayOrder: number): BillingTierDisplay => ({
  ...publicTier(id, displayOrder),
  displayName: `Private ${id}`,
})

describe('billing tier display composition', () => {
  it('merges, dedupes, and sorts public/private tiers', () => {
    const result = composeBillingTierDisplays({
      publicTiers: [publicTier('b', 2), publicTier('a', 1)],
      privateTiers: [privateTier('b', 2), privateTier('c', 1)],
    })
    expect(result.map((tier) => tier.id)).toEqual(['a', 'c', 'b'])
    expect(result.filter((tier) => tier.id === 'b')).toHaveLength(1)
    expect(result.find((tier) => tier.id === 'b')?.displayName).toBe('Private b')
  })

  it('does not synthesize tiers missing from both catalogs', () => {
    const result = composeBillingTierDisplays({
      publicTiers: [],
      privateTiers: [],
    })
    expect(result).toEqual([])
  })
})
