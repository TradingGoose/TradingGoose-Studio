import { describe, expect, it } from 'vitest'
import {
  evaluateSubscriptionTierAvailability,
  evaluateSubscriptionTierRenewalEligibility,
} from './tier-availability-policy'

describe('tier availability policy', () => {
  it.each([
    ['active', true, true, true, 'selectable'],
    ['active', false, false, true, 'not-visible'],
    ['archived', true, false, true, 'archived'],
    ['archived', false, false, true, 'archived'],
    ['draft', true, false, false, 'draft'],
  ] as const)(
    '%s visible=%s',
    (status, isVisible, isSelectable, isCurrentPeriodDisplayable, reason) => {
      expect(evaluateSubscriptionTierAvailability({ tier: { status }, isVisible })).toEqual({
        isSelectable,
        isCurrentPeriodDisplayable,
        reason,
      })
    }
  )

  it('treats a missing tier as unavailable', () => {
    expect(evaluateSubscriptionTierAvailability({ tier: null, isVisible: true })).toEqual({
      isSelectable: false,
      isCurrentPeriodDisplayable: false,
      reason: 'missing',
    })
  })

  it.each([
    ['active', true, 'renewable'],
    ['draft', false, 'draft'],
    ['archived', false, 'archived'],
    [null, false, 'missing-tier'],
  ] as const)('evaluates renewal status %s', (status, isRenewable, reason) => {
    expect(evaluateSubscriptionTierRenewalEligibility({ tier: { status } })).toEqual({
      isRenewable,
      reason,
    })
  })
})
