import { describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { getPersonalPaygUiState, shouldOpenBillingPortalForPaygActivationError } from './payg-ui'

describe('getPersonalPaygUiState', () => {
  const labels = getPublicCopy('en').workspace.settingsModal.subscription.badges
  const base = {
    billingBlocked: false,
    hasPaymentMethodOnFile: true,
    hasStripeSubscription: true,
    hasStripeMonthlyPriceId: true,
    subscriptionStatus: 'active',
    canEditUsageLimit: false,
    tierCanEditUsageLimit: true,
  } as const

  const testCases = [
    [
      'shows resolve payment for blocked billing',
      { billingBlocked: true },
      {
        badgeText: labels.resolvePayment,
        primaryAction: 'resolve_payment',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'shows add payment method before activation',
      { hasPaymentMethodOnFile: false, hasStripeSubscription: false, tierCanEditUsageLimit: false },
      {
        badgeText: labels.addPaymentMethod,
        primaryAction: 'add_payment_method',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'shows activate PAYG once a payment method exists',
      { hasStripeSubscription: false, tierCanEditUsageLimit: false },
      {
        badgeText: labels.activatePayg,
        primaryAction: 'activate_payg',
        showBadge: true,
        showUsageLimitControl: false,
      },
    ],
    [
      'shows increase limit when usage can be edited',
      { canEditUsageLimit: true },
      {
        badgeText: labels.increaseLimit,
        primaryAction: 'increase_limit',
        showBadge: true,
        showUsageLimitControl: true,
      },
    ],
    [
      'shows manage billing for fixed Stripe-backed states',
      { subscriptionStatus: 'trialing', tierCanEditUsageLimit: false },
      {
        badgeText: labels.manageBilling,
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
        badgeText: labels.addPaymentMethod,
        primaryAction: 'add_payment_method',
        showBadge: false,
        showUsageLimitControl: false,
      },
    ],
  ] as const

  it.each(testCases)('%s', (_name, overrides, expected) => {
    expect(
      getPersonalPaygUiState({
        ...base,
        ...overrides,
        labels,
      })
    ).toEqual(expected)
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
