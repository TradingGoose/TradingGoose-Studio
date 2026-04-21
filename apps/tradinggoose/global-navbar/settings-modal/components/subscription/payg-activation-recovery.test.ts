import { describe, expect, it } from 'vitest'
import { shouldOpenBillingPortalForPaygActivationError } from './payg-activation-recovery'

describe('shouldOpenBillingPortalForPaygActivationError', () => {
  it('routes recoverable Stripe payment failures to the billing portal', () => {
    expect(
      shouldOpenBillingPortalForPaygActivationError(402, {
        error: 'This payment requires additional user action before it can succeed.',
        code: 'authentication_required',
      })
    ).toBe(true)

    expect(
      shouldOpenBillingPortalForPaygActivationError(402, {
        error: 'Your card was declined.',
        code: 'card_declined',
      })
    ).toBe(true)
  })

  it('routes missing-payment-state activation failures to the billing portal', () => {
    expect(
      shouldOpenBillingPortalForPaygActivationError(409, {
        error: 'No default payment method on file',
      })
    ).toBe(true)

    expect(
      shouldOpenBillingPortalForPaygActivationError(409, {
        error: 'Stripe customer not found',
      })
    ).toBe(true)
  })

  it('keeps non-recoverable activation failures on the local error path', () => {
    expect(
      shouldOpenBillingPortalForPaygActivationError(409, {
        error: 'Current billing tier is not an inactive personal pay-as-you-go tier',
      })
    ).toBe(false)

    expect(
      shouldOpenBillingPortalForPaygActivationError(500, {
        error: 'Failed to activate PAYG',
      })
    ).toBe(false)
  })
})
