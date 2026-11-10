import { describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import {
  buildTierMutationInputFromDefaults,
  createTierFormDefaults,
  getConfiguredLimitSummary,
  getTierStatusOptions,
} from './tier-editor'

const copy = getPublicCopy('en').admin.billing

describe('tier editor lifecycle contracts', () => {
  it('removes draft from the status choices after activation', () => {
    expect(getTierStatusOptions(copy, false).map(({ value }) => value)).toEqual([
      'active',
      'archived',
    ])
  })

  it('counts the optional workflow timeout without requiring it', () => {
    const defaults = createTierFormDefaults()

    expect(getConfiguredLimitSummary(defaults)).toEqual({ count: 0, total: 8 })
    expect(
      getConfiguredLimitSummary({ ...defaults, workflowExecutionTimeLimitSeconds: '60' })
    ).toEqual({ count: 1, total: 8 })
  })
})

describe('exact admin tier form values', () => {
  it('keeps precision in form defaults and mutation JSON through validation/persistence', async () => {
    const { adminBillingTierMutationSchema, toBillingTierMutationValues } = await import(
      '@/lib/admin/billing/tier-mutations'
    )
    const amount = '9007199254740993.30000000000000001'
    const defaults = {
      ...createTierFormDefaults(),
      displayName: 'Precision',
      description: 'Exact amount',
      monthlyPriceUsd: amount,
      includedUsageLimitUsd: '0.30000000000000001',
      workflowModelCostMultiplier: '0.000000000000000000000000000001',
    }
    const input = buildTierMutationInputFromDefaults(defaults)
    const parsed = adminBillingTierMutationSchema.parse(JSON.parse(JSON.stringify(input)))
    const stored = toBillingTierMutationValues(parsed, 'admin')
    expect(stored.monthlyPriceUsd).toBe(amount)
    expect(stored.includedUsageLimitUsd).toBe(defaults.includedUsageLimitUsd)
    expect(stored.workflowModelCostMultiplier).toBe(defaults.workflowModelCostMultiplier)
    const reconstructed = createTierFormDefaults({
      ...parsed,
      id: 'tier',
      subscriptionCount: 0,
    } as any)
    expect(reconstructed.monthlyPriceUsd).toBe(amount)
    expect(reconstructed.yearlyPriceUsd).toBe('')
  })
  it('does not silently coerce invalid money or unsafe count text', () => {
    expect(() =>
      buildTierMutationInputFromDefaults({ ...createTierFormDefaults(), monthlyPriceUsd: '0x10' })
    ).toThrow()
    expect(() =>
      buildTierMutationInputFromDefaults({
        ...createTierFormDefaults(),
        seatCount: '9007199254740993',
      })
    ).toThrow('safe integer')
  })
})
