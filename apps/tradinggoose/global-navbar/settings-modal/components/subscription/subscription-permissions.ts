import type {
  EnterprisePlaceholderDisplay,
  PublicBillingTierDisplay,
} from '@/lib/billing/public-catalog'
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
  currentTier: PublicBillingTierDisplay | null
  isOrganizationPlan: boolean
  isAdjustableSeatPlan: boolean
  isCustomOrganizationPlan: boolean
  canManageOrganizationPlan: boolean
  canEditUsageLimit: boolean
  showTeamMemberView: boolean
  visibleUpgradeTiers: PublicBillingTierDisplay[]
  showEnterprisePlaceholder: boolean
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

interface SubscriptionSurfaceInput {
  subscription: SubscriptionState
  userRole: UserRole
  publicTiers: PublicBillingTierDisplay[]
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

function getCurrentTier(
  subscription: SubscriptionState,
  publicTiers: PublicBillingTierDisplay[]
): PublicBillingTierDisplay | null {
  const matchedTier = subscription.tier.id
    ? publicTiers.find((tier) => tier.id === subscription.tier.id)
    : null
  if (matchedTier) {
    return matchedTier
  }

  if (!subscription.isFree) {
    return null
  }

  return publicTiers.find((tier) => tier.isDefault) ?? null
}

export function getSubscriptionSurfaceState({
  subscription,
  userRole,
  publicTiers,
  enterprisePlaceholder,
}: SubscriptionSurfaceInput): SubscriptionSurfaceState {
  const currentTier = getCurrentTier(subscription, publicTiers)
  const effectiveTier = currentTier ?? subscription.tier
  const isCurrentOrganizationPlan = effectiveTier.ownerType === 'organization'
  const isCurrentCustomOrganizationPlan =
    isCurrentOrganizationPlan && !currentTier && !subscription.isFree
  const isCurrentAdjustableSeatPlan =
    isCurrentOrganizationPlan && effectiveTier.seatMode === 'adjustable'
  const canEditUsageLimit = canTierEditUsageLimit(effectiveTier)
  const isTeamMemberView = isCurrentOrganizationPlan && !userRole.isTeamAdmin

  let visibleUpgradeTiers: PublicBillingTierDisplay[] = []

  if (!isTeamMemberView && !isCurrentCustomOrganizationPlan) {
    const currentDisplayOrder = currentTier?.displayOrder ?? (subscription.isFree ? -1 : null)

    if (subscription.isFree) {
      visibleUpgradeTiers = publicTiers.filter((tier) => !tier.isDefault)
    } else if (currentDisplayOrder !== null) {
      visibleUpgradeTiers = publicTiers.filter(
        (tier) => tier.id !== currentTier?.id && tier.displayOrder > currentDisplayOrder
      )
    }
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
    canEditUsageLimit:
      canEditUsageLimit && (!isCurrentOrganizationPlan || userRole.isTeamAdmin),
    showTeamMemberView: isTeamMemberView && !isCurrentCustomOrganizationPlan,
    visibleUpgradeTiers,
    showEnterprisePlaceholder,
    enterprisePlaceholder,
  }
}
