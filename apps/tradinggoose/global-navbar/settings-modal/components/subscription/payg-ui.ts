export type PaygActivationErrorPayload = {
  error?: string
  code?: string | null
}

export type PersonalPaygPrimaryAction =
  | 'resolve_payment'
  | 'add_payment_method'
  | 'activate_payg'
  | 'increase_limit'
  | 'manage_billing'

export type PersonalPaygUiState = {
  badgeText: string
  primaryAction: PersonalPaygPrimaryAction
  showBadge: boolean
  showUsageLimitControl: boolean
}

export type PersonalPaygUiLabels = {
  resolvePayment: string
  addPaymentMethod: string
  activatePayg: string
  increaseLimit: string
  manageBilling: string
}

const PAYMENT_RESOLUTION_STATUSES = new Set([
  'past_due',
  'incomplete',
  'incomplete_expired',
  'unpaid',
])

export function getPersonalPaygUiState(params: {
  billingBlocked: boolean
  hasPaymentMethodOnFile: boolean
  hasStripeSubscription: boolean
  hasStripeMonthlyPriceId: boolean
  subscriptionStatus: string | null | undefined
  canEditUsageLimit: boolean
  tierCanEditUsageLimit: boolean
  labels: PersonalPaygUiLabels
}): PersonalPaygUiState {
  const showBadge = params.tierCanEditUsageLimit || params.hasStripeMonthlyPriceId
  const needsPaymentResolution =
    params.billingBlocked || PAYMENT_RESOLUTION_STATUSES.has(params.subscriptionStatus ?? '')

  if (needsPaymentResolution) {
    return {
      badgeText: params.labels.resolvePayment,
      primaryAction: 'resolve_payment',
      showBadge,
      showUsageLimitControl: false,
    }
  }

  if (!params.hasPaymentMethodOnFile) {
    return {
      badgeText: params.labels.addPaymentMethod,
      primaryAction: 'add_payment_method',
      showBadge,
      showUsageLimitControl: false,
    }
  }

  if (!params.hasStripeSubscription) {
    return {
      badgeText: params.labels.activatePayg,
      primaryAction: 'activate_payg',
      showBadge,
      showUsageLimitControl: false,
    }
  }

  if (params.canEditUsageLimit) {
    return {
      badgeText: params.labels.increaseLimit,
      primaryAction: 'increase_limit',
      showBadge,
      showUsageLimitControl: true,
    }
  }

  return {
    badgeText: params.labels.manageBilling,
    primaryAction: 'manage_billing',
    showBadge,
    showUsageLimitControl: false,
  }
}

export function shouldOpenBillingPortalForPaygActivationError(
  status: number,
  payload: PaygActivationErrorPayload | null | undefined
): boolean {
  return (
    status === 402 || (status === 409 && payload?.error === 'No default payment method on file')
  )
}
