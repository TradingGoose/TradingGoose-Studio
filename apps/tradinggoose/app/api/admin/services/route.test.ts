/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const {
  mockGetSystemAdminAccess,
  mockClaimFirstSystemAdmin,
  mockListAdminSystemServices,
  mockUpdateAdminSystemService,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSystemAdminAccess: vi.fn(),
  mockClaimFirstSystemAdmin: vi.fn(),
  mockListAdminSystemServices: vi.fn(),
  mockUpdateAdminSystemService: vi.fn(),
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

vi.mock('@/lib/admin/system-services', () => ({
  adminSystemServiceUpdateSchema: z.object({
    serviceId: z.string().trim().min(1),
    credentials: z.array(
      z.object({
        key: z.string().trim().min(1),
        value: z.string(),
        hasValue: z.boolean(),
      })
    ),
    settings: z.array(
      z.object({
        key: z.string().trim().min(1),
        value: z.string(),
        hasValue: z.boolean(),
      })
    ),
  }),
  listAdminSystemServices: mockListAdminSystemServices,
  updateAdminSystemService: mockUpdateAdminSystemService,
  SystemServiceValidationError: class SystemServiceValidationError extends Error {},
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

describe('/api/admin/services route', () => {
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
    mockListAdminSystemServices.mockResolvedValue({
      services: [
        {
          id: 'browserbase',
          displayName: 'Browserbase',
          description: 'Browser sessions',
          credentials: [
            {
              key: 'apiKey',
              label: 'API Key',
              description: 'Credential',
              value: '',
              hasValue: true,
            },
          ],
          settings: [
            {
              key: 'projectId',
              label: 'Project ID',
              description: 'Project',
              type: 'text',
              value: 'proj_123',
              hasValue: true,
              defaultValue: '',
            },
          ],
        },
      ],
    })
    mockUpdateAdminSystemService.mockResolvedValue({
      services: [
        {
          id: 'browserbase',
          displayName: 'Browserbase',
          description: 'Browser sessions',
          credentials: [
            {
              key: 'apiKey',
              label: 'API Key',
              description: 'Credential',
              value: '',
              hasValue: true,
            },
          ],
          settings: [
            {
              key: 'projectId',
              label: 'Project ID',
              description: 'Project',
              type: 'text',
              value: 'proj_next',
              hasValue: true,
              defaultValue: '',
            },
          ],
        },
      ],
    })
  })

  it('claims bootstrap ownership before returning the service snapshot', async () => {
    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      services: [
        {
          id: 'browserbase',
          displayName: 'Browserbase',
          description: 'Browser sessions',
          credentials: [
            {
              key: 'apiKey',
              label: 'API Key',
              description: 'Credential',
              value: '',
              hasValue: true,
            },
          ],
          settings: [
            {
              key: 'projectId',
              label: 'Project ID',
              description: 'Project',
              type: 'text',
              value: 'proj_123',
              hasValue: true,
              defaultValue: '',
            },
          ],
        },
      ],
    })
    expect(mockClaimFirstSystemAdmin).toHaveBeenCalledWith('user-1')
    expect(mockClaimFirstSystemAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mockListAdminSystemServices.mock.invocationCallOrder[0]
    )
  })

  it('rejects the request when the bootstrap claim is lost', async () => {
    mockClaimFirstSystemAdmin.mockResolvedValueOnce(false)

    const { GET } = await import('./route')

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload).toEqual({ error: 'Forbidden' })
    expect(mockListAdminSystemServices).not.toHaveBeenCalled()
  })

  it('accepts plaintext credentials on write without echoing them back', async () => {
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new Request('http://localhost/api/admin/services', {
        method: 'PATCH',
        body: JSON.stringify({
          serviceId: 'browserbase',
          credentials: [
            {
              key: 'apiKey',
              value: 'secret-api-key',
              hasValue: true,
            },
          ],
          settings: [
            {
              key: 'projectId',
              value: 'proj_next',
              hasValue: true,
            },
          ],
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mockUpdateAdminSystemService).toHaveBeenCalledWith({
      serviceId: 'browserbase',
      credentials: [
        {
          key: 'apiKey',
          value: 'secret-api-key',
          hasValue: true,
        },
      ],
      settings: [
        {
          key: 'projectId',
          value: 'proj_next',
          hasValue: true,
        },
      ],
    })
    expect(payload.services[0].credentials).toEqual([
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Credential',
        value: '',
        hasValue: true,
      },
    ])
    expect(payload.services[0].credentials[0].value).not.toBe('secret-api-key')
    expect(payload.services[0].settings).toEqual([
      {
        key: 'projectId',
        label: 'Project ID',
        description: 'Project',
        type: 'text',
        value: 'proj_next',
        hasValue: true,
        defaultValue: '',
      },
    ])
  })
})
