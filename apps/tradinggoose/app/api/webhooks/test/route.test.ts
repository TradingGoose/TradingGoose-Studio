import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('operator Stripe webhook setup contract', () => {
  it('advertises the complete locally owned lifecycle event list', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    for (const event of [
      'charge.succeeded',
      'invoice.created',
      'invoice.finalized',
      'invoice.payment_failed',
      'invoice.payment_succeeded',
      'customer.subscription.created',
      'customer.subscription.deleted',
    ]) {
      expect(source).toContain(`'${event}'`)
    }
    expect(source).not.toContain('triggers/stripe/webhook')
  })
})
