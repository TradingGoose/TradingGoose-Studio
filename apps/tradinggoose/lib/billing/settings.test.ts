/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockEq,
  mockGetDefaultBillingTier,
  mockGetSystemSettingsRecord,
  mockHasStripeSecretKey,
  mockResolveSystemSettingsFlags,
} = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
  },
  mockEq: vi.fn(),
  mockGetDefaultBillingTier: vi.fn(),
  mockGetSystemSettingsRecord: vi.fn(),
  mockHasStripeSecretKey: vi.fn(),
  mockResolveSystemSettingsFlags: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemBillingSettings: {
    id: 'systemBillingSettings.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
}))

vi.mock('@/lib/billing/tiers', () => ({
  getDefaultBillingTier: mockGetDefaultBillingTier,
}))

vi.mock('@/lib/system-services/stripe-runtime', () => ({
  hasStripeSecretKey: mockHasStripeSecretKey,
}))

vi.mock('@/lib/system-settings/service', () => ({
  getSystemSettingsRecord: mockGetSystemSettingsRecord,
  resolveSystemSettingsFlags: mockResolveSystemSettingsFlags,
}))

function createSelectQueryMock(result: unknown) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
  }

  return query
}

describe('billing settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockDb.select.mockImplementation(() => createSelectQueryMock([]))
    mockGetSystemSettingsRecord.mockResolvedValue(null)
    mockResolveSystemSettingsFlags.mockReturnValue({
      billingEnabled: true,
    })
    mockHasStripeSecretKey.mockReturnValue(true)
    mockGetDefaultBillingTier.mockResolvedValue({ id: 'tier_default' })
  })

  it('disables effective billing when Stripe is not configured', async () => {
    mockHasStripeSecretKey.mockReturnValueOnce(false)

    const { getResolvedBillingSettings } = await import('./settings')
    const result = await getResolvedBillingSettings()

    expect(result.billingEnabled).toBe(false)
    expect(result.stripeConfigured).toBe(false)
  })

  it('keeps effective billing enabled when both the system flag and Stripe are configured', async () => {
    const { isBillingEnabledForRuntime } = await import('./settings')

    await expect(isBillingEnabledForRuntime()).resolves.toBe(true)
  })

  it('exposes the effective billing gate state', async () => {
    mockHasStripeSecretKey.mockReturnValueOnce(false)

    const { getBillingGateState } = await import('./settings')

    await expect(getBillingGateState()).resolves.toEqual({
      billingEnabled: false,
      stripeConfigured: false,
    })
  })
})
