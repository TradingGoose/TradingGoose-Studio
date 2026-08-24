/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetBillingGateState = vi.fn()
const mockRequireStripeClient = vi.fn()
const mockEnsureStripeUserCustomer = vi.fn()
const mockStripeBillingPortalSessionsCreate = vi.fn()
const mockStripeBillingPortalConfigurationsList = vi.fn()
const mockStripeBillingPortalConfigurationsCreate = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/settings', () => ({
  BILLING_DISABLED_ERROR: 'Billing is not enabled.',
  getBillingGateState: mockGetBillingGateState,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: mockRequireStripeClient,
}))

vi.mock('@/lib/billing/stripe-customers', () => ({
  ensureStripeUserCustomer: mockEnsureStripeUserCustomer,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'https://example.com',
}))

async function postPortal() {
  const { POST } = await import('./route')
  return POST()
}

function expectPortalSession(customer: string) {
  expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith({
    customer,
    return_url: 'https://example.com/workspace',
    configuration: 'bpc_management',
  })
}

describe('/api/billing/portal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
    })
    mockRequireStripeClient.mockReturnValue({
      billingPortal: {
        configurations: {
          create: mockStripeBillingPortalConfigurationsCreate,
          list: mockStripeBillingPortalConfigurationsList,
        },
        sessions: {
          create: mockStripeBillingPortalSessionsCreate,
        },
      },
    })
    mockEnsureStripeUserCustomer.mockResolvedValue({
      id: 'cus_user_123',
    })
    mockStripeBillingPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.test/session',
    })
    mockStripeBillingPortalConfigurationsCreate.mockResolvedValue({ id: 'bpc_management' })
    mockStripeBillingPortalConfigurationsList.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          id: 'bpc_default',
          is_default: true,
          business_profile: {
            headline: null,
            privacy_policy_url: null,
            terms_of_service_url: null,
          },
          login_page: { enabled: false },
          features: {
            customer_update: { enabled: true, allowed_updates: ['email'] },
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            subscription_cancel: {
              enabled: true,
              mode: 'at_period_end',
              proration_behavior: 'none',
              cancellation_reason: { enabled: false, options: [] },
            },
            subscription_update: { enabled: false },
          },
        }
      },
    })
  })

  it('opens a personal billing portal session from the shared Stripe customer result', async () => {
    const response = await postPortal()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.url).toBe('https://billing.stripe.test/session')
    expect(mockEnsureStripeUserCustomer).toHaveBeenCalledWith(expect.any(Object), {
      logger: expect.any(Object),
      userId: 'user-1',
    })
    expectPortalSession('cus_user_123')
  })

  it('returns 404 when no personal user record can be resolved', async () => {
    mockEnsureStripeUserCustomer.mockResolvedValueOnce(null)

    const response = await postPortal()
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toBe('User not found')
    expect(mockStripeBillingPortalSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns 500 when shared personal customer resolution fails', async () => {
    mockEnsureStripeUserCustomer.mockRejectedValueOnce(new Error('Stripe API unavailable'))

    const response = await postPortal()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Failed to create billing portal session')
    expect(mockStripeBillingPortalSessionsCreate).not.toHaveBeenCalled()
  })
})
