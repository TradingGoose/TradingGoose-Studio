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
  mockUpsertSystemSettings,
  mockLogger,
} = vi.hoisted(() => ({
  mockBackfillDefaultUserSubscriptions: vi.fn(),
  mockGetSystemAdminAccess: vi.fn(),
  mockClaimFirstSystemAdmin: vi.fn(),
  mockGetResolvedSystemSettings: vi.fn(),
  mockIsBillingConfigurationReady: vi.fn(),
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
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })
    mockUpsertSystemSettings.mockResolvedValue({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })
    mockBackfillDefaultUserSubscriptions.mockResolvedValue(3)
  })

  it('claims bootstrap ownership before returning the system settings snapshot', async () => {
    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
      billingReady: true,
    })
    expect(payload).not.toHaveProperty('stripeSecretKey')
    expect(payload).not.toHaveProperty('stripeWebhookSecret')
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

  it('backfills default subscriptions only after enabling billing is saved', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: true,
          allowPromotionCodes: false,
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      billingEnabled: true,
      billingReady: true,
    })
    expect(mockBackfillDefaultUserSubscriptions).toHaveBeenCalledTimes(1)
    expect(mockUpsertSystemSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mockBackfillDefaultUserSubscriptions.mock.invocationCallOrder[0]
    )
    expect(mockUpsertSystemSettings).toHaveBeenCalledWith({
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
    })
  })

  it('does not backfill subscriptions when disabling billing', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })
    mockUpsertSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: false,
          allowPromotionCodes: false,
        }),
      }) as any
    )

    expect(response.status).toBe(200)
    expect(mockBackfillDefaultUserSubscriptions).not.toHaveBeenCalled()
  })

  it('rejects enabling billing before billing configuration is ready', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: '',
    })
    mockIsBillingConfigurationReady.mockResolvedValueOnce(false)

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: true,
          allowPromotionCodes: true,
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({
      error: 'Billing cannot be enabled until an active public default user tier is configured.',
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
    expect(mockBackfillDefaultUserSubscriptions).not.toHaveBeenCalled()
  })

  it('rejects invalid request data', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: true,
          allowPromotionCodes: false,
          emailDomain: '   ',
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ error: 'Invalid request data' })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
  })
})
