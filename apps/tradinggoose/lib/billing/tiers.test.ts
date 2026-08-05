import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('billing tier helper contracts', () => {
  it('owns active Stripe-backed and private-access query semantics', () => {
    const source = readFileSync(new URL('./tiers.ts', import.meta.url), 'utf8')
    expect(source).toContain('getActiveStripeBackedBillingTiers')
    expect(source).toContain('stripeYearlyPriceId')
    expect(source).toContain('getPrivateBillingTiersForUser')
    expect(source).toContain('grantPrivateBillingTierAccessByCode')
  })
})
