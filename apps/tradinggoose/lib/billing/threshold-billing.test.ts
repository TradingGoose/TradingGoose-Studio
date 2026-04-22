/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockEq,
  mockGetResolvedBillingSettings,
  mockLogger,
  mockRequireStripeClient,
  mockResolveWorkspaceBillingContext,
  mockSql,
  mockStripeFinalizeInvoice,
  mockStripeInvoiceItemsCreate,
  mockStripeInvoicesCreate,
  mockStripeInvoicesPay,
  mockStripeSubscriptionsRetrieve,
} = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
  },
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockGetResolvedBillingSettings: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  mockRequireStripeClient: vi.fn(),
  mockResolveWorkspaceBillingContext: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
  mockStripeFinalizeInvoice: vi.fn(),
  mockStripeInvoiceItemsCreate: vi.fn(),
  mockStripeInvoicesCreate: vi.fn(),
  mockStripeInvoicesPay: vi.fn(),
  mockStripeSubscriptionsRetrieve: vi.fn(),
}))

const userStatsTable = {
  userId: 'userStats.userId',
  billedOverageThisPeriod: 'userStats.billedOverageThisPeriod',
  currentPeriodCost: 'userStats.currentPeriodCost',
}

let statsRows: Array<Record<string, unknown>> = []
let updatedStats: Array<Record<string, unknown>> = []

const mockTx = {
  insert: vi.fn(),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        for: vi.fn(() => ({
          limit: vi.fn(async () => statsRows),
        })),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((values) => ({
      where: vi.fn(async () => {
        updatedStats.push(values)
        return []
      }),
    })),
  })),
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: mockDb.transaction,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  organizationBillingLedger: {
    organizationId: 'organizationBillingLedger.organizationId',
    billedOverageThisPeriod: 'organizationBillingLedger.billedOverageThisPeriod',
    currentPeriodCost: 'organizationBillingLedger.currentPeriodCost',
    currentPeriodCopilotCost: 'organizationBillingLedger.currentPeriodCopilotCost',
    updatedAt: 'organizationBillingLedger.updatedAt',
  },
  organizationMemberBillingLedger: {
    organizationId: 'organizationMemberBillingLedger.organizationId',
    currentPeriodCost: 'organizationMemberBillingLedger.currentPeriodCost',
  },
  userStats: userStatsTable,
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
  sql: mockSql,
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mockGetResolvedBillingSettings,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: mockRequireStripeClient,
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkflowBillingContext: vi.fn(),
  resolveWorkspaceBillingContext: mockResolveWorkspaceBillingContext,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

const paygTier = {
  id: 'tier_payg',
  displayName: 'Pay As You Go',
  ownerType: 'user',
  usageScope: 'individual',
  seatMode: 'fixed',
  monthlyPriceUsd: 0,
  yearlyPriceUsd: 0,
  includedUsageLimitUsd: 5,
}

describe('checkAndBillOverageThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    statsRows = [
      {
        currentPeriodCost: '9.00',
        billedOverageThisPeriod: '0',
      },
    ]
    updatedStats = []

    mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => Promise<void>) =>
      callback(mockTx)
    )
    mockGetResolvedBillingSettings.mockResolvedValue({
      overageThresholdDollars: 3,
    })
    mockResolveWorkspaceBillingContext.mockResolvedValue({
      subscription: {
        id: 'sub_local',
        status: 'active',
        stripeSubscriptionId: 'sub_stripe_123',
        periodEnd: new Date('2026-05-01T00:00:00.000Z'),
        tier: paygTier,
      },
      tier: paygTier,
      scopeType: 'user',
      scopeId: 'user-1',
      billingOwner: {
        type: 'user',
      },
      billingUserId: 'user-1',
    })
    mockStripeSubscriptionsRetrieve.mockResolvedValue({
      customer: 'cus_123',
      default_payment_method: 'pm_123',
    })
    mockStripeInvoicesCreate.mockResolvedValue({
      id: 'in_123',
    })
    mockStripeInvoiceItemsCreate.mockResolvedValue({})
    mockStripeFinalizeInvoice.mockResolvedValue({
      id: 'in_123',
      status: 'open',
    })
    mockStripeInvoicesPay.mockResolvedValue({})
    mockRequireStripeClient.mockReturnValue({
      subscriptions: {
        retrieve: mockStripeSubscriptionsRetrieve,
      },
      invoices: {
        create: mockStripeInvoicesCreate,
        finalizeInvoice: mockStripeFinalizeInvoice,
        pay: mockStripeInvoicesPay,
      },
      invoiceItems: {
        create: mockStripeInvoiceItemsCreate,
      },
    })
  })

  it('creates a threshold invoice for an active $0 PAYG subscription using included usage limit only', async () => {
    const { checkAndBillOverageThreshold } = await import('./threshold-billing')

    await checkAndBillOverageThreshold({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockStripeInvoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 400,
        customer: 'cus_123',
        description: 'Usage overage ($4.00)',
      }),
      expect.any(Object),
    )
    expect(updatedStats).toEqual([
      expect.objectContaining({
        billedOverageThisPeriod: expect.any(Object),
      }),
    ])
  })

  it('does not create a threshold invoice until unbilled overage reaches the configured threshold', async () => {
    statsRows = [
      {
        currentPeriodCost: '9.00',
        billedOverageThisPeriod: '0',
      },
    ]
    mockGetResolvedBillingSettings.mockResolvedValue({
      overageThresholdDollars: 5,
    })

    const { checkAndBillOverageThreshold } = await import('./threshold-billing')

    await checkAndBillOverageThreshold({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockStripeInvoicesCreate).not.toHaveBeenCalled()
    expect(mockStripeInvoiceItemsCreate).not.toHaveBeenCalled()
    expect(updatedStats).toEqual([])
  })

  it('logs and exits when an active subscription is missing its Stripe subscription ID', async () => {
    mockResolveWorkspaceBillingContext.mockResolvedValueOnce({
      subscription: {
        id: 'sub_local',
        status: 'active',
        stripeSubscriptionId: null,
        periodEnd: new Date('2026-05-01T00:00:00.000Z'),
        tier: paygTier,
      },
      tier: paygTier,
      scopeType: 'user',
      scopeId: 'user-1',
      billingOwner: {
        type: 'user',
      },
      billingUserId: 'user-1',
    })

    const { checkAndBillOverageThreshold } = await import('./threshold-billing')

    await checkAndBillOverageThreshold({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockLogger.error).toHaveBeenCalledWith('No Stripe subscription ID found', {
      billingUserId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: undefined,
    })
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockStripeInvoicesCreate).not.toHaveBeenCalled()
  })
})
