import type { EnterprisePlaceholderDisplay } from '@/lib/billing/public-catalog'
import type { SubscriptionTierDisplay } from '@/lib/billing/subscription-tier-display'
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
  currentTier: SubscriptionTierDisplay | null
  isOrganizationPlan: boolean
  isAdjustableSeatPlan: boolean
  isCustomOrganizationPlan: boolean
  canManageOrganizationPlan: boolean
  canEditUsageLimit: boolean
  showTeamMemberView: boolean
  visiblePlanTiers: SubscriptionTierDisplay[]
  showEnterprisePlaceholder: boolean
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

interface SubscriptionSurfaceInput {
  subscription: SubscriptionState
  userRole: UserRole
  subscriptionTiers: SubscriptionTierDisplay[]
  enterpriseContactCard: EnterprisePlaceholderDisplay | null
}

function getCurrentTier(
  subscription: SubscriptionState,
  subscriptionTiers: SubscriptionTierDisplay[]
): SubscriptionTierDisplay | null {
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
  enterpriseContactCard,
}: SubscriptionSurfaceInput): SubscriptionSurfaceState {
  const currentTier = getCurrentTier(subscription, subscriptionTiers)
  const effectiveTier = currentTier ?? subscription.tier
  const isCurrentOrganizationPlan = effectiveTier.ownerType === 'organization'
  const isCurrentCustomOrganizationPlan =
    isCurrentOrganizationPlan && !subscription.isFree && (!currentTier || currentTier.isCurrentOnly)
  const isCurrentAdjustableSeatPlan =
    isCurrentOrganizationPlan && effectiveTier.seatMode === 'adjustable'
  const canEditUsageLimit = canTierEditUsageLimit(effectiveTier)
  const isTeamMemberView = isCurrentOrganizationPlan && !userRole.isTeamAdmin

  const visiblePlanTiers = subscriptionTiers
  const showEnterprisePlaceholder = Boolean(enterpriseContactCard)

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
    enterprisePlaceholder: enterpriseContactCard,
  }
}
