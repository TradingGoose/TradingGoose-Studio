/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockClaimFirstSystemAdmin,
  mockGetSystemAdminAccess,
  mockGetRegistrationMode,
  mockListWaitlistEntries,
  mockLogger,
  mockSetRegistrationMode,
  mockUpdateWaitlistStatuses,
} = vi.hoisted(() => ({
  mockClaimFirstSystemAdmin: vi.fn(),
  mockGetSystemAdminAccess: vi.fn(),
  mockGetRegistrationMode: vi.fn(),
  mockListWaitlistEntries: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockSetRegistrationMode: vi.fn(),
  mockUpdateWaitlistStatuses: vi.fn(),
}))

vi.mock('@/lib/admin/access', () => ({
  claimFirstSystemAdmin: mockClaimFirstSystemAdmin,
  getSystemAdminAccess: mockGetSystemAdminAccess,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

vi.mock('@/lib/registration/service', () => ({
  getRegistrationMode: (...args: unknown[]) => mockGetRegistrationMode(...args),
  listWaitlistEntries: (...args: unknown[]) => mockListWaitlistEntries(...args),
  setRegistrationMode: (...args: unknown[]) => mockSetRegistrationMode(...args),
  updateWaitlistStatuses: (...args: unknown[]) => mockUpdateWaitlistStatuses(...args),
}))

describe('/api/admin/registration route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetSystemAdminAccess.mockResolvedValue({
      session: { activeOrganizationId: null },
      user: { id: 'user-1' },
      userId: 'user-1',
      isAuthenticated: true,
      isSystemAdmin: true,
      canBootstrapSystemAdmin: false,
    })
    mockGetRegistrationMode.mockResolvedValue('waitlist')
    mockListWaitlistEntries.mockResolvedValue([])
  })

  it('does not leak internal waitlist update errors to admin clients', async () => {
    mockUpdateWaitlistStatuses.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "waitlist_email_idx"')
    )

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/admin/registration', {
        method: 'PATCH',
        body: JSON.stringify({
          type: 'waitlist',
          ids: ['entry-1'],
          status: 'approved',
        }),
      }) as any
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Failed to update registration settings',
    })
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
