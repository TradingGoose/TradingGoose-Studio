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
  isOrganizationOwner: boolean
}

export interface SubscriptionSurfaceState {
  currentTier: PublicBillingTierDisplay | null
  isOrganizationPlan: boolean
  isCustomOrganizationPlan: boolean
  canManageOrganizationPlan: boolean
  canEditUsageLimit: boolean
  showNonOwnerOrganizationView: boolean
  visiblePlanTiers: PublicBillingTierDisplay[]
  showEnterprisePlaceholder: boolean
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

interface SubscriptionSurfaceInput {
  subscription: SubscriptionState
  userRole: UserRole
  publicTiers: PublicBillingTierDisplay[]
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
}

export const mergeAccessibleBillingTiers = (
  publicTiers: readonly PublicBillingTierDisplay[] = [],
  privateTiers: readonly PublicBillingTierDisplay[] = []
) =>
  [...publicTiers, ...privateTiers].sort(
    (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id)
  )

export function getSubscriptionTierAlternatives(
  tiers: PublicBillingTierDisplay[],
  ownerType: PublicBillingTierDisplay['ownerType'],
  currentTierId?: string | null
) {
  return tiers.filter(
    (tier) => !tier.isDefault && tier.id !== currentTierId && tier.ownerType === ownerType
  )
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

  if (subscription.tier.id) {
    return {
      ...subscription.tier,
      id: subscription.tier.id,
      description: '',
      isDefault: subscription.isFree,
    }
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
  const isCurrentOrganizationPlan = subscription.tier.ownerType === 'organization'
  const isCurrentCustomOrganizationPlan =
    isCurrentOrganizationPlan && subscription.isPaid && !subscription.tier.hasStripeMonthlyPriceId
  const canEditUsageLimit = canTierEditUsageLimit(subscription.tier)
  const isNonOwnerOrganizationPlan = isCurrentOrganizationPlan && !userRole.isOrganizationOwner

  let visiblePlanTiers: PublicBillingTierDisplay[] = []

  if (isNonOwnerOrganizationPlan) {
    visiblePlanTiers = []
  } else if (isCurrentCustomOrganizationPlan) {
    visiblePlanTiers = currentTier ? [currentTier] : []
  } else {
    const alternativeTiers = getSubscriptionTierAlternatives(
      publicTiers,
      subscription.tier.ownerType,
      currentTier?.id
    )

    visiblePlanTiers = currentTier ? [currentTier, ...alternativeTiers] : alternativeTiers
  }

  const showEnterprisePlaceholder = Boolean(
    enterprisePlaceholder && !isCurrentCustomOrganizationPlan && !isNonOwnerOrganizationPlan
  )

  return {
    currentTier,
    isOrganizationPlan: isCurrentOrganizationPlan,
    isCustomOrganizationPlan: isCurrentCustomOrganizationPlan,
    canManageOrganizationPlan: isCurrentOrganizationPlan && userRole.isOrganizationOwner,
    canEditUsageLimit:
      canEditUsageLimit && (!isCurrentOrganizationPlan || userRole.isOrganizationOwner),
    showNonOwnerOrganizationView: isNonOwnerOrganizationPlan,
    visiblePlanTiers,
    showEnterprisePlaceholder,
    enterprisePlaceholder,
  }
}
