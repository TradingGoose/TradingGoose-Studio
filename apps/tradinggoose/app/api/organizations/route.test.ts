/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockCreateOrganizationForOrganizationTier = vi.fn()
const selectMock = vi.fn()
let selectResult: unknown = []

function createSelectLimitedBuilder(result: unknown) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(result),
  }

  return builder
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: selectMock,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: {
    id: 'member.id',
    userId: 'member.userId',
    organizationId: 'member.organizationId',
    role: 'member.role',
  },
  organization: {
    id: 'organization.id',
    name: 'organization.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((field, value) => ({ field, value })),
  or: vi.fn((...conditions) => conditions),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/organization', () => ({
  createOrganizationForOrganizationTier: mockCreateOrganizationForOrganizationTier,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('/api/organizations route', () => {
  beforeEach(() => {
    mockGetSession.mockReset()
    mockCreateOrganizationForOrganizationTier.mockReset()
    selectMock.mockReset()
    selectResult = []
    selectMock.mockImplementation(() => createSelectLimitedBuilder(selectResult))

    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User One',
      },
    })
    mockCreateOrganizationForOrganizationTier.mockResolvedValue('org-new')
  })

  it('returns 401 when no session exists for POST', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const { POST } = await import('@/app/api/organizations/route')
    const response = await POST(createMockRequest('POST', { name: 'Acme', slug: 'acme' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized - no active session',
    })
  })

  it('returns 409 when the user already belongs to an organization', async () => {
    selectResult = [{ id: 'member-1' }]

    const { POST } = await import('@/app/api/organizations/route')
    const response = await POST(createMockRequest('POST', { name: 'Acme', slug: 'acme' }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error:
        'You are already a member of an organization. Leave your current organization before creating a new one.',
    })
    expect(mockCreateOrganizationForOrganizationTier).not.toHaveBeenCalled()
  })
})
