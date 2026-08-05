import { describe, expect, it } from 'vitest'
import {
  composeSubscriptionTierDisplays,
  type SubscriptionTierDisplay,
} from '@/lib/billing/subscription-tier-display'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { BillingTierSummary } from '@/lib/subscription/types'
import { getSubscriptionSurfaceState } from './subscription-permissions'

const adminRole = { isTeamAdmin: true }
const memberRole = { isTeamAdmin: false }

function buildTier(overrides: Partial<SubscriptionTierDisplay>): SubscriptionTierDisplay {
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
    status: 'active',
    isPublic: true,
    isCurrentOnly: false,
    ...overrides,
  }
}

function toSummary(tier: SubscriptionTierDisplay): BillingTierSummary {
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
      subscriptionTiers: publicTiers,
      enterpriseContactCard: null,
    })

    expect(state.currentTier?.id).toBe('tier_free')
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([
      'tier_free',
      'tier_pro',
      'tier_team',
    ])
  })

  it('shows all accessible tiers for paid users', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: toSummary(proTier),
      },
      userRole: adminRole,
      subscriptionTiers: publicTiers,
      enterpriseContactCard: null,
    })

    expect(state.currentTier?.id).toBe('tier_pro')
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([
      'tier_free',
      'tier_pro',
      'tier_team',
    ])
  })

  it('keeps plan discovery visible for organization team members', () => {
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
      subscriptionTiers: [...publicTiers, orgTier],
      enterpriseContactCard: null,
    })

    expect(state.showTeamMemberView).toBe(true)
    expect(state.visiblePlanTiers).toHaveLength(4)
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
      subscriptionTiers: publicTiers,
      enterpriseContactCard: {
        displayName: 'Enterprise',
        description: 'Custom billing',
        pricingFeatures: [],
        contactUrl: null,
      },
    })

    expect(state.currentTier).toBeNull()
    expect(state.isCustomOrganizationPlan).toBe(true)
    expect(state.visiblePlanTiers).toEqual(publicTiers)
    expect(state.showEnterprisePlaceholder).toBe(true)
  })

  it.each(['active', 'archived'] as const)(
    'keeps %s organization current-only tiers in custom management state',
    (status) => {
      const currentTier: BillingTierSummary = {
        ...EMPTY_BILLING_TIER_SUMMARY,
        id: `tier_org_${status}`,
        displayName: 'Private Organization',
        status,
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'fixed',
        displayOrder: 10,
        isPublic: false,
      }
      const subscriptionTiers = composeSubscriptionTierDisplays({
        publicTiers: [],
        privateTiers: [],
        currentTier,
      })
      const enterpriseContactCard = {
        displayName: 'Enterprise' as const,
        description: 'Custom billing',
        pricingFeatures: [],
        contactUrl: null,
      }

      const state = getSubscriptionSurfaceState({
        subscription: {
          isFree: false,
          isPaid: true,
          tier: currentTier,
        },
        userRole: adminRole,
        subscriptionTiers,
        enterpriseContactCard,
      })

      expect(state.currentTier?.isCurrentOnly).toBe(true)
      expect(state.isCustomOrganizationPlan).toBe(true)
      expect(state.visiblePlanTiers).toEqual(subscriptionTiers)
      expect(state.showEnterprisePlaceholder).toBe(true)
    }
  )
})
