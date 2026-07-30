import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin billing snapshot contract', () => {
  it('owns entitled counts and archive state through canonical symbols', () => {
    const source = readFileSync(new URL('./snapshot.ts', import.meta.url), 'utf8')
    expect(source).toContain('BILLING_ENTITLED_SUBSCRIPTION_STATUSES')
    expect(source).toContain('entitledSubscriptionCount')
    expect(source).toContain('archiveAction')
    expect(source).toContain('accessCode: tier.accessCode')
  })
})
