import { describe, expect, it } from 'vitest'
import { getPersonalPaygUiState, shouldOpenBillingPortalForPaygActivationError } from './payg-ui'

describe('getPersonalPaygUiState', () => {
  const base = {
    billingBlocked: false,
    hasPaymentMethodOnFile: true,
    hasStripeSubscription: true,
    hasStripeMonthlyPriceId: true,
    subscriptionStatus: 'active',
    canEditUsageLimit: false,
    tierCanEditUsageLimit: true,
  } as const

  it.each([
    [
      'shows resolve payment for blocked billing',
      { billingBlocked: true },
      {
        badgeText: 'Resolve Payment',
        primaryAction: 'resolve_payment',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'shows add payment method before activation',
      { hasPaymentMethodOnFile: false, hasStripeSubscription: false, tierCanEditUsageLimit: false },
      {
        badgeText: 'Add Payment Method',
        primaryAction: 'add_payment_method',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'shows activate PAYG once a payment method exists',
      { hasStripeSubscription: false, tierCanEditUsageLimit: false },
      {
        badgeText: 'Activate PAYG',
        primaryAction: 'activate_payg',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'shows increase limit when usage can be edited',
      { canEditUsageLimit: true },
      {
        badgeText: 'Increase Limit',
        primaryAction: 'increase_limit',
        showBadge: true,
        showUsageLimitControl: true,
      },
    ],
    [
      'shows manage billing for fixed Stripe-backed states',
      { subscriptionStatus: 'trialing', tierCanEditUsageLimit: false },
      {
        badgeText: 'Manage Billing',
        primaryAction: 'manage_billing',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'hides the badge for non-Stripe-backed non-editable tiers',
      {
        hasPaymentMethodOnFile: false,
        hasStripeSubscription: false,
        hasStripeMonthlyPriceId: false,
        tierCanEditUsageLimit: false,
      },
      {
        badgeText: 'Add Payment Method',
        primaryAction: 'add_payment_method',
        showBadge: false,
        showUsageLimitControl: false,
      },
    ],
  ])('%s', (_name, overrides, expected) => {
    expect(getPersonalPaygUiState({ ...base, ...overrides })).toEqual(expected)
  })
})

describe('shouldOpenBillingPortalForPaygActivationError', () => {
  it.each([
    [402, { error: 'Your card was declined.', code: 'card_declined' }, true],
    [409, { error: 'No default payment method on file' }, true],
    [404, { error: 'User not found' }, false],
    [500, { error: 'Failed to activate PAYG' }, false],
  ])('returns %s => %s', (status, payload, expected) => {
    expect(shouldOpenBillingPortalForPaygActivationError(status, payload)).toBe(expected)
  })
})
