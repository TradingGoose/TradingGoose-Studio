/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireAdminBillingUserId,
  mockGetBillingGateState,
  mockIsBillingEnabledForRuntime,
  mockCount,
  mockEq,
  mockLogger,
  mockTierLimit,
  mockCountWhere,
  mockTransaction,
} = vi.hoisted(() => ({
  mockRequireAdminBillingUserId: vi.fn(),
  mockGetBillingGateState: vi.fn(),
  mockIsBillingEnabledForRuntime: vi.fn(),
  mockCount: vi.fn(() => 'count-expression'),
  mockEq: vi.fn((left, right) => ({ left, right })),
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  mockTierLimit: vi.fn(),
  mockCountWhere: vi.fn(),
  mockTransaction: vi.fn(),
}))

const tierSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: mockTierLimit,
}

const countSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: mockCountWhere,
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn((selection?: unknown) =>
      selection === undefined ? tierSelectChain : countSelectChain,
    ),
    transaction: mockTransaction,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  subscription: {
    billingTierId: 'subscription.billingTierId',
  },
  systemBillingTier: {
    id: 'systemBillingTier.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  count: mockCount,
  eq: mockEq,
}))

vi.mock('@/lib/admin/billing/authorization', () => ({
  requireAdminBillingUserId: mockRequireAdminBillingUserId,
}))

vi.mock('@/lib/billing/settings', () => ({
  ADMIN_BILLING_UNAVAILABLE_ERROR: 'Billing is unavailable',
  getBillingGateState: mockGetBillingGateState,
  isBillingEnabledForRuntime: mockIsBillingEnabledForRuntime,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

function createPayload() {
  return {
    displayName: 'Pro',
    description: 'Paid tier',
    status: 'active',
    ownerType: 'organization',
    usageScope: 'pooled',
    seatMode: 'adjustable',
    monthlyPriceUsd: 49,
    yearlyPriceUsd: 499,
    includedUsageLimitUsd: 100,
    storageLimitGb: 100,
    concurrencyLimit: 10,
    seatCount: 5,
    seatMaximum: 20,
    stripeMonthlyPriceId: 'price_monthly',
    stripeYearlyPriceId: 'price_yearly',
    stripeProductId: 'prod_123',
    syncRateLimitPerMinute: 120,
    asyncRateLimitPerMinute: 60,
    apiEndpointRateLimitPerMinute: 300,
    maxPendingAgeSeconds: null,
    maxPendingCount: null,
    canEditUsageLimit: true,
    canConfigureSso: true,
    logRetentionDays: 30,
    workflowExecutionMultiplier: 1,
    workflowModelCostMultiplier: 1.5,
    functionExecutionMultiplier: 1,
    copilotCostMultiplier: 1,
    pricingFeatures: ['Priority support'],
    isPublic: true,
    isDefault: false,
    displayOrder: 1,
  }
}

describe('PATCH /api/admin/billing/tiers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    tierSelectChain.from.mockReturnThis()
    tierSelectChain.where.mockReturnThis()
    countSelectChain.from.mockReturnThis()

    mockRequireAdminBillingUserId.mockResolvedValue('admin-user-1')
    mockGetBillingGateState.mockResolvedValue({ stripeConfigured: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockTierLimit.mockResolvedValue([
      {
        id: 'tier-pro',
        isDefault: false,
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'adjustable',
        stripeMonthlyPriceId: 'price_monthly',
        stripeYearlyPriceId: 'price_yearly',
        stripeProductId: 'prod_123',
      },
    ])
    mockCountWhere.mockResolvedValue([{ count: 3 }])
    mockTransaction.mockResolvedValue(undefined)
  })

  it('rejects edits that omit the Stripe monthly price ID', async () => {
    const { PATCH } = await import('./route')
    const payload = {
      ...createPayload(),
      stripeMonthlyPriceId: null,
    }

    const response = await PATCH(
      new Request('http://localhost/api/admin/billing/tiers/tier-pro', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }) as any,
      { params: Promise.resolve({ id: 'tier-pro' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('New tiers must configure a Stripe monthly price ID')
    expect(mockTierLimit).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['workflowExecutionMultiplier', 'workflow execution multiplier'],
    ['functionExecutionMultiplier', 'function execution multiplier'],
  ])(
    'rejects zero %s for tiers that already have subscriptions',
    async (field, label) => {
      const { PATCH } = await import('./route')
      const payload = createPayload()
      payload[field as 'workflowExecutionMultiplier' | 'functionExecutionMultiplier'] = 0

      const response = await PATCH(
        new Request('http://localhost/api/admin/billing/tiers/tier-pro', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }) as any,
        { params: Promise.resolve({ id: 'tier-pro' }) },
      )
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toContain(label)
      expect(data.error).toContain('Create a separate free tier')
      expect(mockTransaction).not.toHaveBeenCalled()
    },
  )
})
