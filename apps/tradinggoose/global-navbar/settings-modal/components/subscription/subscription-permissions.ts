import type { BillingTierDisplay, EnterprisePlaceholderDisplay } from '@/lib/billing/public-catalog'
import { canTierEditUsageLimit } from '@/lib/billing/tier-summary'
import type { BillingTierSummary } from '@/lib/subscription/types'

export interface SubscriptionState {
  isFree: boolean
  isPaid: boolean
  tier: BillingTierSummary
}

export interface UserRole {
  isTeamAdmin: boolean
}

export interface SubscriptionSurfaceState {
  currentTier: BillingTierDisplay | null
  isOrganizationPlan: boolean
  isAdjustableSeatPlan: boolean
  isCustomOrganizationPlan: boolean
  canManageOrganizationPlan: boolean
  canEditUsageLimit: boolean
  showTeamMemberView: boolean
  visiblePlanTiers: BillingTierDisplay[]
  showEnterprisePlaceholder: boolean
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

interface SubscriptionSurfaceInput {
  subscription: SubscriptionState
  userRole: UserRole
  subscriptionTiers: BillingTierDisplay[]
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

function getCurrentTier(
  subscription: SubscriptionState,
  subscriptionTiers: BillingTierDisplay[]
): BillingTierDisplay | null {
  const matchedTier = subscription.tier.id
    ? subscriptionTiers.find((tier) => tier.id === subscription.tier.id)
    : null
  if (matchedTier) {
    return matchedTier
  }

  if (!subscription.isFree) {
    return null
  }

  return subscriptionTiers.find((tier) => tier.isDefault) ?? null
}

export function getSubscriptionSurfaceState({
  subscription,
  userRole,
  subscriptionTiers,
  enterprisePlaceholder,
}: SubscriptionSurfaceInput): SubscriptionSurfaceState {
  const currentTier = getCurrentTier(subscription, subscriptionTiers)
  const effectiveTier = currentTier ?? subscription.tier
  const isCurrentOrganizationPlan = effectiveTier.ownerType === 'organization'
  const isCurrentCustomOrganizationPlan =
    isCurrentOrganizationPlan && !currentTier && !subscription.isFree
  const isCurrentAdjustableSeatPlan =
    isCurrentOrganizationPlan && effectiveTier.seatMode === 'adjustable'
  const canEditUsageLimit = canTierEditUsageLimit(effectiveTier)
  const isTeamMemberView = isCurrentOrganizationPlan && !userRole.isTeamAdmin

  let visiblePlanTiers: BillingTierDisplay[] = []

  if (!isTeamMemberView && !isCurrentCustomOrganizationPlan) {
    const currentDisplayOrder = currentTier?.displayOrder ?? (subscription.isFree ? -1 : null)
    const upgradableTiers = subscription.isFree
      ? subscriptionTiers.filter((tier) => !tier.isDefault)
      : currentDisplayOrder !== null
        ? subscriptionTiers.filter(
            (tier) => tier.id !== currentTier?.id && tier.displayOrder > currentDisplayOrder
          )
        : []

    visiblePlanTiers = currentTier
      ? [currentTier, ...upgradableTiers.filter((tier) => tier.id !== currentTier.id)]
      : upgradableTiers
  }

  const showEnterprisePlaceholder = Boolean(
    enterprisePlaceholder && !isCurrentCustomOrganizationPlan && !isTeamMemberView
  )

  return {
    currentTier,
    isOrganizationPlan: isCurrentOrganizationPlan,
    isAdjustableSeatPlan: isCurrentAdjustableSeatPlan,
    isCustomOrganizationPlan: isCurrentCustomOrganizationPlan,
    canManageOrganizationPlan: isCurrentOrganizationPlan && userRole.isTeamAdmin,
    canEditUsageLimit: canEditUsageLimit && (!isCurrentOrganizationPlan || userRole.isTeamAdmin),
    showTeamMemberView: isTeamMemberView && !isCurrentCustomOrganizationPlan,
    visiblePlanTiers,
    showEnterprisePlaceholder,
    enterprisePlaceholder,
  }
}
