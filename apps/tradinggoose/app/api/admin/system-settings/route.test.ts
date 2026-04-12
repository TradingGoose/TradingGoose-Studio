/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBackfillDefaultUserSubscriptions,
  mockGetSystemAdminAccess,
  mockClaimFirstSystemAdmin,
  mockGetResolvedSystemSettings,
  mockIsBillingConfigurationReady,
  mockSetCachedStripeSettings,
  mockUpsertSystemSettings,
  mockLogger,
} = vi.hoisted(() => ({
  mockBackfillDefaultUserSubscriptions: vi.fn(),
  mockGetSystemAdminAccess: vi.fn(),
  mockClaimFirstSystemAdmin: vi.fn(),
  mockGetResolvedSystemSettings: vi.fn(),
  mockIsBillingConfigurationReady: vi.fn(),
  mockSetCachedStripeSettings: vi.fn(),
  mockUpsertSystemSettings: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/admin/access', () => ({
  claimFirstSystemAdmin: mockClaimFirstSystemAdmin,
  getSystemAdminAccess: mockGetSystemAdminAccess,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  backfillDefaultUserSubscriptions: mockBackfillDefaultUserSubscriptions,
}))

vi.mock('@/lib/billing/settings', () => ({
  isBillingConfigurationReady: mockIsBillingConfigurationReady,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

vi.mock('@/lib/system-settings/service', () => ({
  getResolvedSystemSettings: mockGetResolvedSystemSettings,
  upsertSystemSettings: mockUpsertSystemSettings,
}))

vi.mock('@/lib/system-settings/stripe-runtime', () => ({
  setCachedStripeSettings: mockSetCachedStripeSettings,
}))

describe('/api/admin/system-settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetSystemAdminAccess.mockResolvedValue({
      session: { activeOrganizationId: null },
      user: { id: 'user-1' },
      userId: 'user-1',
      isAuthenticated: true,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: true,
    })
    mockClaimFirstSystemAdmin.mockResolvedValue(true)
    mockIsBillingConfigurationReady.mockResolvedValue(true)
    mockGetResolvedSystemSettings.mockResolvedValue({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })
    mockUpsertSystemSettings.mockResolvedValue({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })
    mockBackfillDefaultUserSubscriptions.mockResolvedValue(3)
  })

  it('claims bootstrap ownership before returning secret-bearing system settings', async () => {
    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
      billingReady: true,
    })
    expect(mockClaimFirstSystemAdmin).toHaveBeenCalledWith('user-1')
    expect(mockClaimFirstSystemAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetResolvedSystemSettings.mock.invocationCallOrder[0]
    )
  })

  it('rejects the request when the bootstrap claim is lost', async () => {
    mockClaimFirstSystemAdmin.mockResolvedValueOnce(false)

    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload).toEqual({ error: 'Forbidden' })
    expect(mockGetResolvedSystemSettings).not.toHaveBeenCalled()
    expect(mockIsBillingConfigurationReady).not.toHaveBeenCalled()
  })

  it('backfills default subscriptions before and after enabling billing', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: true,
          allowPromotionCodes: false,
          stripeSecretKey: 'sk_test_123',
          stripeWebhookSecret: 'whsec_456',
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.billingEnabled).toBe(true)
    expect(mockBackfillDefaultUserSubscriptions).toHaveBeenCalledTimes(2)
    expect(mockUpsertSystemSettings).toHaveBeenCalledWith({
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })
    expect(mockSetCachedStripeSettings).toHaveBeenCalledWith({
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })
  })

  it('does not backfill subscriptions when disabling billing', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })
    mockUpsertSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_test_123',
      stripeWebhookSecret: 'whsec_456',
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: false,
          allowPromotionCodes: false,
          stripeSecretKey: 'sk_test_123',
          stripeWebhookSecret: 'whsec_456',
        }),
      }) as any
    )

    expect(response.status).toBe(200)
    expect(mockBackfillDefaultUserSubscriptions).not.toHaveBeenCalled()
  })
})
