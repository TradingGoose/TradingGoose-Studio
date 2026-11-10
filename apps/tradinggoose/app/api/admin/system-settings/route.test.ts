/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_ERROR_CODES } from '@/app/admin/constants'

const {
  mockAssertFinancialStorageReady,
  mockFinancialSchedulerReady,
  mockGetSystemAdminAccess,
  mockClaimFirstSystemAdmin,
  mockGetBillingGateState,
  mockGetResolvedSystemSettings,
  mockIsBillingConfigurationReady,
  mockIsTriggerConfigurationReady,
  mockUpsertSystemSettings,
  mockLogger,
  MockTriggerExecutionBusyError,
} = vi.hoisted(() => ({
  mockAssertFinancialStorageReady: vi.fn(),
  mockFinancialSchedulerReady: vi.fn(),
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
  MockTriggerExecutionBusyError: class TriggerExecutionBusyError extends Error {
    code = 'trigger_execution_busy' as const

    constructor() {
      super('Trigger.dev execution mode cannot change while executions are queued or running.')
      this.name = 'TriggerExecutionBusyError'
    }
  },
}))

vi.mock('@tradinggoose/db', () => ({
  db: { transaction: async (run: (tx: object) => Promise<void>) => run({}) },
}))
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  assertFinancialStorageReady: mockAssertFinancialStorageReady,
}))

vi.mock('@/lib/admin/access', () => ({
  claimFirstSystemAdmin: mockClaimFirstSystemAdmin,
  getSystemAdminAccess: mockGetSystemAdminAccess,
}))

vi.mock('@/lib/billing/native-finance', () => ({
  financialSchedulerReady: mockFinancialSchedulerReady,
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
  TriggerExecutionBusyError: MockTriggerExecutionBusyError,
  upsertSystemSettings: mockUpsertSystemSettings,
}))

describe('/api/admin/system-settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAssertFinancialStorageReady.mockReset().mockResolvedValue(undefined)

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
    mockFinancialSchedulerReady.mockReturnValue(true)
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
    expect(payload).toMatchObject({ error: 'Forbidden', code: ADMIN_ERROR_CODES.FORBIDDEN })
    expect(mockGetResolvedSystemSettings).not.toHaveBeenCalled()
    expect(mockGetBillingGateState).not.toHaveBeenCalled()
    expect(mockIsBillingConfigurationReady).not.toHaveBeenCalled()
    expect(mockIsTriggerConfigurationReady).not.toHaveBeenCalled()
  })

  it('enables billing only after financial dispatch readiness is verified', async () => {
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
    expect(mockFinancialSchedulerReady).toHaveBeenCalledTimes(1)
    expect(mockFinancialSchedulerReady.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpsertSystemSettings.mock.invocationCallOrder[0]
    )
    expect(mockUpsertSystemSettings).toHaveBeenCalledWith({
      registrationMode: 'open',
      billingEnabled: true,
      triggerDevEnabled: false,
      allowPromotionCodes: false,
    })
  })

  it('disables billing without requiring financial dispatch readiness', async () => {
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
    expect(mockFinancialSchedulerReady).not.toHaveBeenCalled()
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
    expect(payload).toMatchObject({
      error: 'Billing cannot be enabled until an active public default user tier is configured.',
      code: ADMIN_ERROR_CODES.BILLING_NOT_READY,
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
    expect(mockFinancialSchedulerReady).not.toHaveBeenCalled()
  })

  it('refuses billing enablement before canonical financial storage is ready', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
      allowPromotionCodes: false,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: '',
      settings: null,
    })
    const { FinancialPolicyError } = await import('@tradinggoose/billing')
    mockAssertFinancialStorageReady.mockRejectedValueOnce(
      new FinancialPolicyError('Required financial index is missing', 503)
    )
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({ billingEnabled: true }),
      }) as any
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: ADMIN_ERROR_CODES.BILLING_NOT_READY })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
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
    expect(payload).toMatchObject({
      error: 'Billing cannot be enabled until STRIPE_SECRET_KEY is configured.',
      code: ADMIN_ERROR_CODES.BILLING_NOT_CONFIGURED,
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
    expect(mockFinancialSchedulerReady).not.toHaveBeenCalled()
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
    expect(payload).toMatchObject({
      error:
        'Trigger.dev cannot be enabled until TRIGGER_PROJECT_ID and TRIGGER_SECRET_KEY are configured.',
      code: ADMIN_ERROR_CODES.TRIGGER_NOT_READY,
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
  })

  it('rejects changing execution mode while work is queued or running', async () => {
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: '',
    })
    mockUpsertSystemSettings.mockRejectedValueOnce(new MockTriggerExecutionBusyError())

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/system-settings', {
        method: 'PATCH',
        body: JSON.stringify({ triggerDevEnabled: true }),
      }) as any
    )

    await expect(response.json()).resolves.toMatchObject({ code: 'trigger_execution_busy' })
    expect(response.status).toBe(409)
    expect(mockUpsertSystemSettings).toHaveBeenCalledWith({ triggerDevEnabled: true })
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
    expect(mockFinancialSchedulerReady).not.toHaveBeenCalled()
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
    expect(payload).toMatchObject({
      error: 'Invalid request data',
      code: ADMIN_ERROR_CODES.INVALID_REQUEST_DATA,
    })
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
    expect(payload).toMatchObject({
      error: 'Invalid request data',
      code: ADMIN_ERROR_CODES.INVALID_REQUEST_DATA,
    })
    expect(mockUpsertSystemSettings).not.toHaveBeenCalled()
  })
})
