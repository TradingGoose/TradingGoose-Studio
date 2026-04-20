/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBackfillDefaultUserSubscriptions,
  mockGetSystemAdminAccess,
  mockClaimFirstSystemAdmin,
  mockGetBillingGateState,
  mockGetResolvedSystemSettings,
  mockIsBillingConfigurationReady,
  mockIsTriggerConfigurationReady,
  mockUpsertSystemSettings,
  mockLogger,
} = vi.hoisted(() => ({
  mockBackfillDefaultUserSubscriptions: vi.fn(),
  mockGetSystemAdminAccess: vi.fn(),
  mockClaimFirstSystemAdmin: vi.fn(),
  mockGetBillingGateState: vi.fn(),
  mockGetResolvedSystemSettings: vi.fn(),
  mockIsBillingConfigurationReady: vi.fn(),
  mockIsTriggerConfigurationReady: vi.fn(),
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
  getBillingGateState: mockGetBillingGateState,
  isBillingConfigurationReady: mockIsBillingConfigurationReady,
}))

vi.mock('@/lib/trigger/settings', () => ({
  isTriggerConfigurationReady: mockIsTriggerConfigurationReady,
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
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })
    mockIsBillingConfigurationReady.mockResolvedValue(true)
    mockIsTriggerConfigurationReady.mockResolvedValue(true)
    mockGetResolvedSystemSettings.mockResolvedValue({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })
    mockUpsertSystemSettings.mockResolvedValue({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: true,
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
      stripeConfigured: true,
      triggerDevEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
      billingReady: true,
      triggerReady: true,
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
    expect(mockGetBillingGateState).not.toHaveBeenCalled()
    expect(mockIsBillingConfigurationReady).not.toHaveBeenCalled()
    expect(mockIsTriggerConfigurationReady).not.toHaveBeenCalled()
  })

  it('backfills default subscriptions only after enabling billing is saved', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
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
          triggerDevEnabled: false,
          allowPromotionCodes: false,
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      billingEnabled: true,
      billingReady: true,
      stripeConfigured: true,
      triggerDevEnabled: true,
      triggerReady: true,
    })
    expect(mockBackfillDefaultUserSubscriptions).toHaveBeenCalledTimes(1)
    expect(mockUpsertSystemSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mockBackfillDefaultUserSubscriptions.mock.invocationCallOrder[0]
    )
    expect(mockUpsertSystemSettings).toHaveBeenCalledWith({
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: false,
      allowPromotionCodes: false,
    })
  })

  it('does not backfill subscriptions when disabling billing', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })
    mockUpsertSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
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
          triggerDevEnabled: false,
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
      triggerDevEnabled: false,
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
          triggerDevEnabled: false,
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

  it('serializes billing as disabled when Stripe is not configured', async () => {
    mockGetBillingGateState.mockResolvedValueOnce({
      billingEnabled: false,
      stripeConfigured: false,
    })

    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      billingEnabled: false,
      stripeConfigured: false,
    })
  })

  it('rejects enabling billing before Stripe is configured', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: '',
    })
    mockGetBillingGateState.mockResolvedValueOnce({
      billingEnabled: false,
      stripeConfigured: false,
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: true,
          triggerDevEnabled: false,
          allowPromotionCodes: true,
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({
      error: 'Billing cannot be enabled until STRIPE_SECRET_KEY is configured.',
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
    expect(mockBackfillDefaultUserSubscriptions).not.toHaveBeenCalled()
  })

  it('rejects enabling Trigger.dev before trigger configuration is ready', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: '',
    })
    mockIsTriggerConfigurationReady.mockResolvedValueOnce(false)

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationMode: 'open',
          billingEnabled: false,
          triggerDevEnabled: true,
          allowPromotionCodes: true,
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({
      error:
        'Trigger.dev cannot be enabled until TRIGGER_PROJECT_ID and TRIGGER_SECRET_KEY are configured.',
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
  })

  it('updates only targeted fields when Stripe is not configured', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })
    mockGetBillingGateState.mockResolvedValueOnce({
      billingEnabled: false,
      stripeConfigured: false,
    })
    mockUpsertSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'support.tradinggoose.ai',
      fromEmailAddress: 'TradingGoose <noreply@tradinggoose.ai>',
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          emailDomain: 'support.tradinggoose.ai',
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      billingEnabled: false,
      stripeConfigured: false,
      emailDomain: 'support.tradinggoose.ai',
    })
    expect(mockUpsertSystemSettings).toHaveBeenCalledWith({
      emailDomain: 'support.tradinggoose.ai',
    })
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
          triggerDevEnabled: false,
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

  it('rejects an empty partial update payload', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ error: 'Invalid request data' })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
  })
})
