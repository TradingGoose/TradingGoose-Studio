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
  mockValidateBillingTierStripeCatalog,
  mockValidateBillingTierStripeMutation,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
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
  mockValidateBillingTierStripeCatalog: vi.fn(),
  mockValidateBillingTierStripeMutation: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
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

const transactionClient = {
  select: vi.fn((selection?: unknown) =>
    selection === undefined ? tierSelectChain : countSelectChain
  ),
  update: mockUpdate,
}

vi.mock('@tradinggoose/db', () => ({
  db: {
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

vi.mock('@/lib/admin/billing/stripe-identifiers', () => ({
  isBillingTierStripeIdentifierError: () => false,
  validateBillingTierStripeCatalog: mockValidateBillingTierStripeCatalog,
  validateBillingTierStripeMutation: mockValidateBillingTierStripeMutation,
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
    accessCode: null,
    status: 'active',
    ownerType: 'organization',
    usageScope: 'pooled',
    seatMode: 'adjustable',
    monthlyPriceUsd: 49,
    yearlyPriceUsd: 499,
    includedUsageLimitUsd: 100,
    storageLimitGb: 100,
    concurrencyLimit: 10,
    workflowExecutionTimeLimitSeconds: null,
    seatCount: 5,
    seatMaximum: 20,
    stripeMonthlyPriceId: 'price_monthly',
    stripeYearlyPriceId: 'price_yearly',
    stripeProductId: null,
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
        status: 'active',
        isDefault: false,
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'adjustable',
        monthlyPriceUsd: '49',
        yearlyPriceUsd: '499',
        stripeMonthlyPriceId: 'price_monthly',
        stripeYearlyPriceId: 'price_yearly',
        stripeProductId: null,
      },
    ])
    mockValidateBillingTierStripeMutation.mockImplementation(async () => (await mockTierLimit())[0])
    mockCountWhere.mockResolvedValue([{ count: 3 }])
    mockUpdateWhere.mockResolvedValue(undefined)
    mockUpdateSet.mockImplementation(() => ({ where: mockUpdateWhere }))
    mockUpdate.mockImplementation(() => ({ set: mockUpdateSet }))
    mockTransaction.mockImplementation(async (callback) => callback(transactionClient))
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
      { params: Promise.resolve({ id: 'tier-pro' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Stripe yearly prices require a Stripe monthly price ID')
    expect(mockTierLimit).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['workflowExecutionMultiplier', 'workflow execution multiplier'],
    ['functionExecutionMultiplier', 'function execution multiplier'],
  ])('rejects zero %s for tiers that already have subscriptions', async (field, label) => {
    const { PATCH } = await import('./route')
    const payload = createPayload()
    payload[field as 'workflowExecutionMultiplier' | 'functionExecutionMultiplier'] = 0

    const response = await PATCH(
      new Request('http://localhost/api/admin/billing/tiers/tier-pro', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }) as any,
      { params: Promise.resolve({ id: 'tier-pro' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toContain(label)
    expect(data.error).toContain('Create a separate free tier')
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('archives a tier that still has subscriptions', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/billing/tiers/tier-pro', {
        method: 'PATCH',
        body: JSON.stringify({ ...createPayload(), status: 'archived' }),
      }) as any,
      { params: Promise.resolve({ id: 'tier-pro' }) }
    )

    await expect(response.json()).resolves.toEqual({ success: true })
    expect(response.status).toBe(200)
    expect(mockCountWhere).toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }))
    expect(mockUpdateWhere).toHaveBeenCalledOnce()
  })

  it.each([
    ['stripeMonthlyPriceId', 'price_replacement'],
    ['monthlyPriceUsd', 1],
  ] as const)('keeps activated %s immutable', async (field, value) => {
    mockCountWhere.mockResolvedValueOnce([{ count: 0 }])
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/billing/tiers/tier-pro', {
        method: 'PATCH',
        body: JSON.stringify({
          ...createPayload(),
          [field]: value,
        }),
      }) as any,
      { params: Promise.resolve({ id: 'tier-pro' }) }
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: `Cannot change ${field} after a tier has been activated. Duplicate the tier and archive the old tier instead.`,
    })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not expose a hard-delete handler', async () => {
    await expect(import('./route')).resolves.not.toHaveProperty('DELETE')
  })

  it('does not archive the default tier', async () => {
    mockTierLimit.mockResolvedValueOnce([
      {
        id: 'tier-default',
        isDefault: true,
      },
    ])
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/billing/tiers/tier-default', {
        method: 'PATCH',
        body: JSON.stringify({ ...createPayload(), status: 'archived' }),
      }) as any,
      { params: Promise.resolve({ id: 'tier-default' }) }
    )

    await expect(response.json()).resolves.toEqual({ error: 'The default tier cannot be archived' })
    expect(response.status).toBe(409)
    expect(mockCountWhere).toHaveBeenCalledOnce()
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not make an archived tier the default tier', async () => {
    mockIsBillingEnabledForRuntime.mockResolvedValueOnce(false)
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/billing/tiers/tier-pro', {
        method: 'PATCH',
        body: JSON.stringify({
          ...createPayload(),
          status: 'archived',
          ownerType: 'user',
          usageScope: 'individual',
          seatMode: 'fixed',
          monthlyPriceUsd: 0,
          yearlyPriceUsd: null,
          seatCount: null,
          seatMaximum: null,
          canConfigureSso: false,
          isDefault: true,
        }),
      }) as any,
      { params: Promise.resolve({ id: 'tier-pro' }) }
    )

    await expect(response.json()).resolves.toEqual({ error: 'The default tier cannot be archived' })
    expect(response.status).toBe(409)
    expect(mockCountWhere).toHaveBeenCalledOnce()
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
