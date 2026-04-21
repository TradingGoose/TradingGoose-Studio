export interface PaygActivationErrorPayload {
  error?: string
  code?: string | null
}

const BILLING_PORTAL_RECOVERY_ERRORS = new Set([
  'No default payment method on file',
  'Stripe customer not found',
])

export function shouldOpenBillingPortalForPaygActivationError(
  status: number,
  payload: PaygActivationErrorPayload | null | undefined
): boolean {
  if (status === 402) {
    return true
  }

  return status === 409 && BILLING_PORTAL_RECOVERY_ERRORS.has(payload?.error ?? '')
}
