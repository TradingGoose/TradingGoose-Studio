/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSystemAdminAccess,
  mockClaimFirstSystemAdmin,
  mockListSystemIntegrations,
  mockUpdateSystemIntegrationBundle,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSystemAdminAccess: vi.fn(),
  mockClaimFirstSystemAdmin: vi.fn(),
  mockListSystemIntegrations: vi.fn(),
  mockUpdateSystemIntegrationBundle: vi.fn(),
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
  updateSystemIntegrationBundle: mockUpdateSystemIntegrationBundle,
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
          value: '',
          hasValue: true,
        },
      ],
    })
  })

  it('claims bootstrap ownership before returning credential presence flags', async () => {
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
          hasValue: true,
        },
      ],
    })
    expect(payload.secrets[0]).not.toHaveProperty('value')
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

  it('accepts plaintext credentials on write without echoing them back', async () => {
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new Request('http://localhost/api/admin/integrations', {
        method: 'PATCH',
        body: JSON.stringify({
          bundleId: 'bundle-1',
          definition: {
            id: 'bundle-1',
            parentId: null,
            displayName: 'Stripe',
            isEnabled: null,
          },
          services: [],
          secrets: [
            {
              id: 'secret-1',
              definitionId: 'bundle-1',
              credentialKey: 'apiKey',
              value: 'secret-api-key',
              hasValue: true,
            },
          ],
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mockUpdateSystemIntegrationBundle).toHaveBeenCalledWith({
      definition: {
        id: 'bundle-1',
        parentId: null,
        name: 'Stripe',
        isEnabled: null,
      },
      services: [],
      secrets: [
        {
          id: 'secret-1',
          definitionId: 'bundle-1',
          key: 'apiKey',
          value: 'secret-api-key',
          hasValue: true,
        },
      ],
    })
    expect(payload.secrets).toEqual([
      {
        id: 'secret-1',
        definitionId: 'bundle-1',
        credentialKey: 'apiKey',
        hasValue: true,
      },
    ])
    expect(payload.secrets[0]).not.toHaveProperty('value')
  })
})
