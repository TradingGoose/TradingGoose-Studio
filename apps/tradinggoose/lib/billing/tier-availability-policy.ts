type TierStatus = 'active' | 'draft' | 'archived' | null

export function evaluateSubscriptionTierAvailability(input: {
  tier: { status: TierStatus } | null | undefined
  isVisible: boolean
}): {
  isSelectable: boolean
  isCurrentPeriodDisplayable: boolean
  reason: 'selectable' | 'missing' | 'not-visible' | 'draft' | 'archived'
} {
  if (!input.tier?.status) {
    return { isSelectable: false, isCurrentPeriodDisplayable: false, reason: 'missing' }
  }
  if (input.tier.status === 'draft') {
    return { isSelectable: false, isCurrentPeriodDisplayable: false, reason: 'draft' }
  }
  if (input.tier.status === 'archived') {
    return { isSelectable: false, isCurrentPeriodDisplayable: true, reason: 'archived' }
  }
  if (!input.isVisible) {
    return { isSelectable: false, isCurrentPeriodDisplayable: true, reason: 'not-visible' }
  }
  return { isSelectable: true, isCurrentPeriodDisplayable: true, reason: 'selectable' }
}

export function evaluateSubscriptionTierRenewalEligibility(subscription: {
  tier: { status: TierStatus } | null | undefined
}): {
  isRenewable: boolean
  reason: 'renewable' | 'missing-tier' | 'draft' | 'archived'
} {
  const status = subscription.tier?.status
  if (status === 'active') return { isRenewable: true, reason: 'renewable' }
  if (status === 'draft') return { isRenewable: false, reason: 'draft' }
  if (status === 'archived') return { isRenewable: false, reason: 'archived' }
  return { isRenewable: false, reason: 'missing-tier' }
}
