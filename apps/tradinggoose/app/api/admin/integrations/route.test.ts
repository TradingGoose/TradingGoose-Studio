/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSystemAdminAccess,
  mockClaimFirstSystemAdmin,
  mockListSystemIntegrations,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSystemAdminAccess: vi.fn(),
  mockClaimFirstSystemAdmin: vi.fn(),
  mockListSystemIntegrations: vi.fn(),
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

vi.mock('@/lib/admin/system-integrations', () => ({
  listSystemIntegrations: mockListSystemIntegrations,
  updateSystemIntegrationBundle: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

describe('/api/admin/integrations route', () => {
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
    mockListSystemIntegrations.mockResolvedValue({
      definitions: [
        {
          id: 'bundle-1',
          parentId: null,
          name: 'Stripe',
          isEnabled: null,
        },
      ],
      secrets: [
        {
          id: 'secret-1',
          definitionId: 'bundle-1',
          key: 'apiKey',
          value: 'secret-api-key',
        },
      ],
    })
  })

  it('claims bootstrap ownership before returning secret-bearing integrations', async () => {
    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      definitions: [
        {
          id: 'bundle-1',
          parentId: null,
          displayName: 'Stripe',
          isEnabled: null,
        },
      ],
      secrets: [
        {
          id: 'secret-1',
          definitionId: 'bundle-1',
          credentialKey: 'apiKey',
          value: 'secret-api-key',
        },
      ],
    })
    expect(mockClaimFirstSystemAdmin).toHaveBeenCalledWith('user-1')
    expect(mockClaimFirstSystemAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mockListSystemIntegrations.mock.invocationCallOrder[0]
    )
  })

  it('rejects the request when the bootstrap claim is lost', async () => {
    mockClaimFirstSystemAdmin.mockResolvedValueOnce(false)

    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload).toEqual({ error: 'Forbidden' })
    expect(mockListSystemIntegrations).not.toHaveBeenCalled()
  })
})
