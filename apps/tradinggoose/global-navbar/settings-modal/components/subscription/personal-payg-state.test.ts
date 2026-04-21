import { describe, expect, it } from 'vitest'
import { getPersonalPaygUiState } from './personal-payg-state'

describe('getPersonalPaygUiState', () => {
  it('shows resolve payment for blocked billing even when a Stripe subscription exists', () => {
    expect(
      getPersonalPaygUiState({
        billingBlocked: true,
        hasPaymentMethodOnFile: true,
        hasStripeSubscription: true,
        hasStripeMonthlyPriceId: true,
        subscriptionStatus: 'active',
        canEditUsageLimit: true,
        tierCanEditUsageLimit: true,
      })
    ).toEqual({
      badgeText: 'Resolve Payment',
      primaryAction: 'resolve_payment',
      showBadge: true,
      showUsageLimitControl: false,
    })
  })

  it('shows resolve payment for past_due subscriptions instead of the usage-limit editor', () => {
    expect(
      getPersonalPaygUiState({
        billingBlocked: false,
        hasPaymentMethodOnFile: true,
        hasStripeSubscription: true,
        hasStripeMonthlyPriceId: true,
        subscriptionStatus: 'past_due',
        canEditUsageLimit: false,
        tierCanEditUsageLimit: false,
      })
    ).toEqual({
      badgeText: 'Resolve Payment',
      primaryAction: 'resolve_payment',
      showBadge: true,
      showUsageLimitControl: false,
    })
  })

  it('shows manage billing for subscribed fixed-limit Stripe-backed states', () => {
    expect(
      getPersonalPaygUiState({
        billingBlocked: false,
        hasPaymentMethodOnFile: true,
        hasStripeSubscription: true,
        hasStripeMonthlyPriceId: true,
        subscriptionStatus: 'trialing',
        canEditUsageLimit: false,
        tierCanEditUsageLimit: false,
      })
    ).toEqual({
      badgeText: 'Manage Billing',
      primaryAction: 'manage_billing',
      showBadge: true,
      showUsageLimitControl: false,
    })
  })

  it('shows increase limit only when the backend editability rule is satisfied', () => {
    expect(
      getPersonalPaygUiState({
        billingBlocked: false,
        hasPaymentMethodOnFile: true,
        hasStripeSubscription: true,
        hasStripeMonthlyPriceId: true,
        subscriptionStatus: 'active',
        canEditUsageLimit: true,
        tierCanEditUsageLimit: true,
      })
    ).toEqual({
      badgeText: 'Increase Limit',
      primaryAction: 'increase_limit',
      showBadge: true,
      showUsageLimitControl: true,
    })
  })

  it('keeps inactive PAYG enrollment states unchanged', () => {
    expect(
      getPersonalPaygUiState({
        billingBlocked: false,
        hasPaymentMethodOnFile: false,
        hasStripeSubscription: false,
        hasStripeMonthlyPriceId: true,
        subscriptionStatus: 'active',
        canEditUsageLimit: false,
        tierCanEditUsageLimit: false,
      })
    ).toEqual({
      badgeText: 'Add Payment Method',
      primaryAction: 'add_payment_method',
      showBadge: true,
      showUsageLimitControl: false,
    })

    expect(
      getPersonalPaygUiState({
        billingBlocked: false,
        hasPaymentMethodOnFile: true,
        hasStripeSubscription: false,
        hasStripeMonthlyPriceId: true,
        subscriptionStatus: 'active',
        canEditUsageLimit: false,
        tierCanEditUsageLimit: false,
      })
    ).toEqual({
      badgeText: 'Activate PAYG',
      primaryAction: 'activate_payg',
      showBadge: true,
      showUsageLimitControl: false,
    })
  })

  it('hides the badge for non-editable personal tiers that are not Stripe-backed', () => {
    expect(
      getPersonalPaygUiState({
        billingBlocked: false,
        hasPaymentMethodOnFile: false,
        hasStripeSubscription: false,
        hasStripeMonthlyPriceId: false,
        subscriptionStatus: 'active',
        canEditUsageLimit: false,
        tierCanEditUsageLimit: false,
      })
    ).toEqual({
      badgeText: 'Add Payment Method',
      primaryAction: 'add_payment_method',
      showBadge: false,
      showUsageLimitControl: false,
    })
  })
})
