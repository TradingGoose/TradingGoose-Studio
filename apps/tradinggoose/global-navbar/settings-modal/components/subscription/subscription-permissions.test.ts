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
    status: 'active',
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

  it('keeps previously granted private tiers available for lateral resubscription', () => {
    const privateTier = buildTier({
      id: 'tier_private',
      displayName: 'Private',
      displayOrder: 0,
      monthlyPriceUsd: 15,
    })

    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: toSummary(proTier),
      },
      userRole: adminRole,
      publicTiers: [freeTier, privateTier, proTier, teamTier],
      enterprisePlaceholder: null,
    })

    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([
      'tier_pro',
      'tier_private',
      'tier_team',
    ])
  })

  it('keeps an authoritative active current tier visible after it becomes private', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: {
          ...toSummary(proTier),
          isPublic: false,
        },
      },
      userRole: adminRole,
      publicTiers: [freeTier, teamTier],
      enterprisePlaceholder: null,
    })

    expect(state.currentTier?.id).toBe(proTier.id)
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([proTier.id, teamTier.id])
  })

  it('offers alternatives only for the authoritative subscription owner type', () => {
    const organizationTier = buildTier({
      id: 'tier_org',
      displayName: 'Organization',
      ownerType: 'organization',
      usageScope: 'pooled',
      seatMode: 'adjustable',
      monthlyPriceUsd: 100,
      seatCount: 3,
    })

    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: toSummary(proTier),
      },
      userRole: adminRole,
      publicTiers: [freeTier, proTier, teamTier, organizationTier],
      enterprisePlaceholder: null,
    })

    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([proTier.id, teamTier.id])
  })

  it('shows active granted alternatives when the current private tier is archived', () => {
    const privateTier = buildTier({
      id: 'tier_private_active',
      displayName: 'Private',
      displayOrder: 1,
      monthlyPriceUsd: 15,
    })

    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'tier_private_archived',
          displayName: 'Archived private tier',
          status: 'archived',
          ownerType: 'user',
        },
      },
      userRole: adminRole,
      publicTiers: [freeTier, proTier, privateTier],
      enterprisePlaceholder: null,
    })

    expect(state.currentTier?.id).toBe('tier_private_archived')
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([
      'tier_private_archived',
      proTier.id,
      privateTier.id,
    ])
  })

  it('lets organization admins leave an archived Stripe-backed tier', () => {
    const replacementOrganizationTier = buildTier({
      id: 'tier_organization_replacement',
      displayName: 'Replacement organization tier',
      ownerType: 'organization',
      usageScope: 'pooled',
      seatMode: 'adjustable',
      monthlyPriceUsd: 120,
      seatCount: 3,
    })
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'tier_organization_archived',
          displayName: 'Archived organization tier',
          status: 'archived',
          ownerType: 'organization',
          usageScope: 'pooled',
          seatMode: 'adjustable',
          hasStripeMonthlyPriceId: true,
        },
      },
      userRole: adminRole,
      publicTiers: [...publicTiers, replacementOrganizationTier],
      enterprisePlaceholder: null,
    })

    expect(state.isCustomOrganizationPlan).toBe(false)
    expect(state.currentTier?.id).toBe('tier_organization_archived')
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual([
      'tier_organization_archived',
      replacementOrganizationTier.id,
    ])
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

  it('shows the authoritative custom organization tier without self-service alternatives', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'tier_enterprise_contract',
          displayName: 'Enterprise Contract',
          status: 'active',
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

    expect(state.currentTier?.id).toBe('tier_enterprise_contract')
    expect(state.isCustomOrganizationPlan).toBe(true)
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual(['tier_enterprise_contract'])
    expect(state.showEnterprisePlaceholder).toBe(false)
  })

  it('shows an archived custom organization contract without self-service actions', () => {
    const state = getSubscriptionSurfaceState({
      subscription: {
        isFree: false,
        isPaid: true,
        tier: {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'tier_archived_contract',
          displayName: 'Archived Contract',
          status: 'archived',
          ownerType: 'organization',
          usageScope: 'pooled',
          seatMode: 'fixed',
          hasStripeMonthlyPriceId: false,
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

    expect(state.currentTier?.id).toBe('tier_archived_contract')
    expect(state.isCustomOrganizationPlan).toBe(true)
    expect(state.visiblePlanTiers.map((tier) => tier.id)).toEqual(['tier_archived_contract'])
    expect(state.showEnterprisePlaceholder).toBe(false)
  })
})
