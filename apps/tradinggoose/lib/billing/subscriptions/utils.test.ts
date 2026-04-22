/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/tier-summary', () => ({
  canTierEditUsageLimit: (tier: { canEditUsageLimit?: boolean | null } | null | undefined) =>
    tier?.canEditUsageLimit ?? false,
}))

import { canEditUsageLimit } from './utils'

describe('canEditUsageLimit', () => {
  it('blocks personal usage-limit editing without an active Stripe subscription', () => {
    expect(
      canEditUsageLimit({
        status: 'active',
        referenceType: 'user',
        stripeSubscriptionId: null,
        tier: {
          canEditUsageLimit: true,
          ownerType: 'user',
        },
      })
    ).toBe(false)
  })

  it('allows personal usage-limit editing with an active Stripe subscription', () => {
    expect(
      canEditUsageLimit({
        status: 'active',
        referenceType: 'user',
        stripeSubscriptionId: 'sub_123',
        tier: {
          canEditUsageLimit: true,
          ownerType: 'user',
        },
      })
    ).toBe(true)
  })

  it('keeps organization usage-limit editing unchanged', () => {
    expect(
      canEditUsageLimit({
        status: 'active',
        referenceType: 'organization',
        stripeSubscriptionId: null,
        tier: {
          canEditUsageLimit: true,
          ownerType: 'organization',
        },
      })
    ).toBe(true)
  })
})
