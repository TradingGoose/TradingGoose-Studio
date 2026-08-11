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

  it('announces saved settings through a polite live region', () => {
    const source = readFileSync(new URL('./billing-admin.tsx', import.meta.url), 'utf8')
    const settingsCard = source.slice(
      source.indexOf('function BillingSettingsCard'),
      source.indexOf('export function AdminBilling')
    )
    expect(settingsCard).toContain("<div role='status'>")
    expect(settingsCard).toContain("<Notice variant='success'")
  })
})
