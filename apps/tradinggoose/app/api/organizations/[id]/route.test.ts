/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Organization DELETE route', () => {
  const selectResults: any[][] = []
  const deleteMock = vi.fn()
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  }))
  const mockAssertOrganizationCanBeDeleted = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        delete: deleteMock,
      },
      member: {
        id: 'member.id',
        userId: 'member.userId',
        organizationId: 'member.organizationId',
        role: 'member.role',
      },
      organization: {
        id: 'organization.id',
        name: 'organization.name',
        slug: 'organization.slug',
        logo: 'organization.logo',
        createdAt: 'organization.createdAt',
        updatedAt: 'organization.updatedAt',
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          name: 'Admin',
        },
      }),
    }))

    vi.doMock('@/lib/billing/validation/seat-management', () => ({
      getOrganizationSeatAnalytics: vi.fn(),
      getOrganizationSeatInfo: vi.fn(),
      updateOrganizationSeats: vi.fn(),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/workspaces/billing-owner', () => ({
      assertOrganizationCanBeDeleted: mockAssertOrganizationCanBeDeleted,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blocks deleting an organization while workspaces are still billed to it', async () => {
    mockAssertOrganizationCanBeDeleted.mockRejectedValue(
      new Error('Cannot delete an organization while workspaces are billed to it')
    )
    selectResults.push([{ id: 'member-1', role: 'owner' }])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/organizations/org-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Cannot delete an organization while workspaces are billed to it',
    })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockAssertOrganizationCanBeDeleted).toHaveBeenCalledWith('org-1')
  })

  it('blocks deleting an organization while it still has a billing subscription', async () => {
    mockAssertOrganizationCanBeDeleted.mockRejectedValue(
      new Error('Cannot delete an organization while it still has a billing subscription')
    )
    selectResults.push([{ id: 'member-1', role: 'owner' }])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/organizations/org-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Cannot delete an organization while it still has a billing subscription',
    })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockAssertOrganizationCanBeDeleted).toHaveBeenCalledWith('org-1')
  })
})
