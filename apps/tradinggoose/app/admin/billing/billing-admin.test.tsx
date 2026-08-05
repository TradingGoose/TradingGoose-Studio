import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin billing overview contract', () => {
  it('keeps provider commerce classification independent from visibility', () => {
    const source = readFileSync(new URL('./billing-admin.tsx', import.meta.url), 'utf8')
    const summary = source.slice(
      source.indexOf('function getTierCommerceSummary'),
      source.indexOf('function formatTierRecurringPrice')
    )
    expect(summary).toContain('stripeMonthlyPriceId')
    expect(summary).toContain('stripeYearlyPriceId')
    expect(summary).not.toContain('isPublic')
  })
})
