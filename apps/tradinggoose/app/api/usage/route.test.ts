/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetUserUsageLimitInfo = vi.fn()
const mockUpdateUserUsageLimit = vi.fn()
const mockGetOrganizationBillingData = vi.fn()
const mockUpdateOrganizationUsageLimit = vi.fn()
const mockIsOrganizationOwnerOrAdmin = vi.fn()
const mockGetBillingGateState = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing', () => ({
  getUserUsageLimitInfo: mockGetUserUsageLimitInfo,
  updateUserUsageLimit: mockUpdateUserUsageLimit,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: mockGetOrganizationBillingData,
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
  updateOrganizationUsageLimit: mockUpdateOrganizationUsageLimit,
}))

vi.mock('@/lib/billing/settings', () => ({
  BILLING_DISABLED_ERROR: 'Billing is not enabled.',
  getBillingGateState: mockGetBillingGateState,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function createGetRequest(url: string) {
  return new NextRequest(new URL(url), { method: 'GET' })
}

describe('/api/usage route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockGetUserUsageLimitInfo.mockResolvedValue({
      currentLimit: Number.MAX_SAFE_INTEGER,
      canEdit: false,
      minimumLimit: 0,
      tier: null,
    })
    mockGetOrganizationBillingData.mockResolvedValue({
      organizationId: 'org-1',
      organizationName: 'Acme',
    })
    mockUpdateOrganizationUsageLimit.mockResolvedValue({ success: true })
  })

  it('returns organization usage even when billing is disabled', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      createGetRequest('http://localhost/api/usage?context=organization&organizationId=org-1')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      context: 'organization',
      userId: 'user-1',
      organizationId: 'org-1',
      data: {
        organizationId: 'org-1',
        organizationName: 'Acme',
      },
    })
    expect(mockIsOrganizationOwnerOrAdmin).toHaveBeenCalledWith('user-1', 'org-1')
  })

  it('returns 403 for organization usage when the user lacks permission', async () => {
    mockIsOrganizationOwnerOrAdmin.mockResolvedValueOnce(false)

    const { GET } = await import('./route')
    const response = await GET(
      createGetRequest('http://localhost/api/usage?context=organization&organizationId=org-1')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Permission denied' })
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
  })

  it('returns 409 for organization usage updates when billing is disabled', async () => {
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: false,
      stripeConfigured: false,
    })

    const { PUT } = await import('./route')
    const response = await PUT(
      new NextRequest('http://localhost/api/usage', {
        method: 'PUT',
        body: JSON.stringify({
          context: 'organization',
          organizationId: 'org-1',
          limit: 10,
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Billing is not enabled.',
    })
    expect(mockUpdateUserUsageLimit).not.toHaveBeenCalled()
  })

  it('returns 400 for personal usage updates when the limit change is rejected', async () => {
    mockUpdateUserUsageLimit.mockResolvedValueOnce({
      success: false,
      error: 'This billing tier cannot edit usage limits',
    })

    const { PUT } = await import('./route')
    const response = await PUT(
      new NextRequest('http://localhost/api/usage', {
        method: 'PUT',
        body: JSON.stringify({
          context: 'user',
          limit: 10,
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'This billing tier cannot edit usage limits',
    })
    expect(mockUpdateUserUsageLimit).toHaveBeenCalledWith('user-1', 10)
  })
})
