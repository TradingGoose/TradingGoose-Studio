import { describe, expect, it } from 'vitest'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { BillingTierSummary } from '@/lib/subscription/types'
import { getSubscriptionSurfaceState } from './subscription-permissions'

const adminRole = { isTeamAdmin: true }
const memberRole = { isTeamAdmin: false }

function buildTier(overrides: Partial<PublicBillingTierDisplay>): PublicBillingTierDisplay {
  return {
    id: 'tier_free',
    displayName: 'Free',
    description: '',
    ownerType: 'user',
    seatMode: 'fixed',
    usageScope: 'individual',
    displayOrder: 0,
    monthlyPriceUsd: 0,
    yearlyPriceUsd: null,
    seatCount: null,
    seatMaximum: null,
    canEditUsageLimit: false,
    pricingFeatures: [],
    isDefault: false,
    ...overrides,
  }
}

function toSummary(tier: PublicBillingTierDisplay): BillingTierSummary {
  return {
    ...EMPTY_BILLING_TIER_SUMMARY,
    id: tier.id,
    displayName: tier.displayName,
    ownerType: tier.ownerType,
    usageScope: tier.usageScope,
    seatMode: tier.seatMode,
    displayOrder: tier.displayOrder,
    monthlyPriceUsd: tier.monthlyPriceUsd,
    yearlyPriceUsd: tier.yearlyPriceUsd,
    seatCount: tier.seatCount,
    seatMaximum: tier.seatMaximum,
    canEditUsageLimit: tier.canEditUsageLimit,
    pricingFeatures: tier.pricingFeatures,
    isPublic: true,
    hasStripeMonthlyPriceId: (tier.monthlyPriceUsd ?? 0) > 0,
  }
}

describe('getSubscriptionSurfaceState', () => {
  const freeTier = buildTier({
    id: 'tier_free',
    displayName: 'Free',
    displayOrder: 0,
    isDefault: true,
  })
  const proTier = buildTier({
    id: 'tier_pro',
    displayName: 'Pro',
    displayOrder: 1,
    monthlyPriceUsd: 20,
  })
  const teamTier = buildTier({
    id: 'tier_team',
    displayName: 'Team',
    displayOrder: 2,
    monthlyPriceUsd: 80,
  })
  const publicTiers = [freeTier, proTier, teamTier]

  it('shows the current default tier before upgrade tiers for free users', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: true,
        isPaid: false,
        tier: toSummary(freeTier),
      },
      userRole: adminRole,
      publicTiers,
      enterprisePlaceholder: null,
    })

    expect(state.currentTier?.id).toBe('tier_free')
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([
      'tier_free',
      'tier_pro',
      'tier_team',
    ])
  })

  it('shows the current paid tier before higher display-order upgrade tiers', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: toSummary(proTier),
      },
      userRole: adminRole,
      publicTiers,
      enterprisePlaceholder: null,
    })

    expect(state.currentTier?.id).toBe('tier_pro')
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual(['tier_pro', 'tier_team'])
  })

  it('keeps organization team members out of the tier chooser', () => {
    const orgTier = buildTier({
      id: 'tier_org',
      displayName: 'Organization',
      ownerType: 'organization',
      usageScope: 'pooled',
      seatMode: 'adjustable',
      displayOrder: 3,
      monthlyPriceUsd: 150,
    })

    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: toSummary(orgTier),
      },
      userRole: memberRole,
      publicTiers: [...publicTiers, orgTier],
      enterprisePlaceholder: null,
    })

    expect(state.showTeamMemberView).toBe(true)
    expect(state.visiblePlanTiers).toEqual([])
  })

  it('does not invent a public current-tier card for custom organization plans', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'tier_enterprise_contract',
          displayName: 'Enterprise Contract',
          ownerType: 'organization',
          usageScope: 'pooled',
          seatMode: 'fixed',
          displayOrder: 99,
        },
      },
      userRole: adminRole,
      publicTiers,
      enterprisePlaceholder: {
        displayName: 'Enterprise',
        description: 'Custom billing',
        pricingFeatures: [],
        contactUrl: null,
      },
    })

    expect(state.currentTier).toBeNull()
    expect(state.isCustomOrganizationPlan).toBe(true)
    expect(state.visiblePlanTiers).toEqual([])
    expect(state.showEnterprisePlaceholder).toBe(false)
  })
})
