import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tiers: vi.fn(), settings: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ groupBy: async () => [] }) }) }) },
}))
vi.mock('@/lib/billing/tiers', () => ({ getAllBillingTiers: mocks.tiers }))
vi.mock('@/lib/billing/settings', () => ({
  DEFAULT_BILLING_SETTINGS: { enterpriseContactUrl: null },
  getResolvedBillingSettings: mocks.settings,
}))

import { getAdminBillingSnapshot } from './snapshot'

beforeEach(() => {
  mocks.tiers.mockResolvedValue([
    {
      id: 'tier',
      monthlyPriceUsd: '9007199254740993.30000000000000001',
      yearlyPriceUsd: null,
      includedUsageLimitUsd: '0.3000000000000000100',
      workflowExecutionMultiplier: '1.00000000000000001',
      workflowModelCostMultiplier: '0.000000000000000000000000000001',
      functionExecutionMultiplier: null,
      copilotCostMultiplier: '1',
      pricingFeatures: [],
    },
  ])
  mocks.settings.mockResolvedValue({
    billingEnabled: true,
    onboardingAllowanceUsd: '0.30000000000000001',
    overageThresholdDollars: '9007199254740993.01',
    workflowExecutionChargeUsd: '0.000000000000000000000000000001',
    functionExecutionChargeUsd: '1.00000000000000001',
    usageWarningThresholdPercent: 80,
    freeTierUpgradeThresholdPercent: 90,
    enterpriseContactUrl: null,
  })
})
describe('admin monetary snapshot transport', () => {
  it('keeps exact canonical strings and configured nulls through snapshot/cache JSON', async () => {
    const snapshot = JSON.parse(JSON.stringify(await getAdminBillingSnapshot()))
    expect(snapshot.currentTiers[0]).toMatchObject({
      monthlyPriceUsd: '9007199254740993.30000000000000001',
      yearlyPriceUsd: null,
      includedUsageLimitUsd: '0.30000000000000001',
      workflowExecutionMultiplier: '1.00000000000000001',
      workflowModelCostMultiplier: '0.000000000000000000000000000001',
      functionExecutionMultiplier: null,
    })
    expect(snapshot.overageThresholdDollars).toBe('9007199254740993.01')
  })
  it('refuses unexpected numeric authority rather than silently accepting a rounded DTO', async () => {
    mocks.tiers.mockResolvedValue([{ monthlyPriceUsd: 0.3 }])
    await expect(getAdminBillingSnapshot()).rejects.toThrow('decimal strings')
  })
})
