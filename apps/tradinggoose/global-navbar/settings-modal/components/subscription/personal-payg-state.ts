export type PersonalPaygPrimaryAction =
  | 'resolve_payment'
  | 'add_payment_method'
  | 'activate_payg'
  | 'increase_limit'
  | 'manage_billing'

interface PersonalPaygUiStateParams {
  billingBlocked: boolean
  hasPaymentMethodOnFile: boolean
  hasStripeSubscription: boolean
  hasStripeMonthlyPriceId: boolean
  subscriptionStatus: string | null | undefined
  canEditUsageLimit: boolean
  tierCanEditUsageLimit: boolean
}

interface PersonalPaygUiState {
  badgeText: string
  primaryAction: PersonalPaygPrimaryAction
  showBadge: boolean
  showUsageLimitControl: boolean
}

const PAYMENT_RESOLUTION_STATUSES = new Set([
  'past_due',
  'incomplete',
  'incomplete_expired',
  'unpaid',
])

export function getPersonalPaygUiState(
  params: PersonalPaygUiStateParams
): PersonalPaygUiState {
  const showBadge = params.tierCanEditUsageLimit || params.hasStripeMonthlyPriceId
  const needsPaymentResolution =
    params.billingBlocked || PAYMENT_RESOLUTION_STATUSES.has(params.subscriptionStatus ?? '')

  if (needsPaymentResolution) {
    return {
      badgeText: 'Resolve Payment',
      primaryAction: 'resolve_payment',
      showBadge,
      showUsageLimitControl: false,
    }
  }

  if (!params.hasPaymentMethodOnFile) {
    return {
      badgeText: 'Add Payment Method',
      primaryAction: 'add_payment_method',
      showBadge,
      showUsageLimitControl: false,
    }
  }

  if (!params.hasStripeSubscription) {
    return {
      badgeText: 'Activate PAYG',
      primaryAction: 'activate_payg',
      showBadge,
      showUsageLimitControl: false,
    }
  }

  if (params.canEditUsageLimit) {
    return {
      badgeText: 'Increase Limit',
      primaryAction: 'increase_limit',
      showBadge,
      showUsageLimitControl: true,
    }
  }

  return {
    badgeText: 'Manage Billing',
    primaryAction: 'manage_billing',
    showBadge,
    showUsageLimitControl: false,
  }
}
