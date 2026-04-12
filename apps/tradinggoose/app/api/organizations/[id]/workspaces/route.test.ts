/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Organization workspaces DELETE route', () => {
  const selectResults: any[][] = []
  const updateWhereMock = vi.fn()
  const updateSetMock = vi.fn(() => ({
    where: updateWhereMock,
  }))
  const updateMock = vi.fn(() => ({
    set: updateSetMock,
  }))
  const mockResolveWorkspaceBillingOwnerUpdate = vi.fn()

  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0
    updateWhereMock.mockResolvedValue([])
    mockResolveWorkspaceBillingOwnerUpdate.mockResolvedValue({
      billingOwnerType: 'user',
      billingOwnerUserId: 'owner-1',
      billingOwnerOrganizationId: null,
    })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        update: updateMock,
      },
      member: {
        id: 'member.id',
        role: 'member.role',
        organizationId: 'member.organizationId',
        userId: 'member.userId',
      },
      user: {
        name: 'user.name',
      },
      permissions: {},
      workspace: {
        id: 'workspace.id',
        ownerId: 'workspace.ownerId',
        name: 'workspace.name',
        billingOwnerType: 'workspace.billingOwnerType',
        billingOwnerUserId: 'workspace.billingOwnerUserId',
        billingOwnerOrganizationId: 'workspace.billingOwnerOrganizationId',
        createdAt: 'workspace.createdAt',
        updatedAt: 'workspace.updatedAt',
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

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        error: vi.fn(),
        info: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getManageableWorkspaces: vi.fn(),
      hasWorkspaceAdminAccess: vi.fn(),
    }))

    vi.doMock('@/lib/workspaces/billing-owner', () => ({
      resolveWorkspaceBillingOwnerUpdate: mockResolveWorkspaceBillingOwnerUpdate,
      toWorkspaceApiRecord: vi.fn((record) => ({
        id: record.id,
        ownerId: record.ownerId,
        name: record.name,
        billingOwner: {
          type: 'user',
          userId: record.billingOwnerUserId,
        },
      })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns a workspace to owner billing for org admins', async () => {
    selectResults.push(
      [{ id: 'member-1', role: 'admin' }],
      [
        {
          id: 'workspace-1',
          ownerId: 'owner-1',
          name: 'Workspace 1',
          billingOwnerType: 'organization',
          billingOwnerUserId: null,
          billingOwnerOrganizationId: 'org-1',
        },
      ],
      [
        {
          id: 'workspace-1',
          ownerId: 'owner-1',
          name: 'Workspace 1',
          billingOwnerType: 'user',
          billingOwnerUserId: 'owner-1',
          billingOwnerOrganizationId: null,
        },
      ]
    )

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest(
        'http://localhost/api/organizations/org-1/workspaces?workspaceId=workspace-1',
        {
          method: 'DELETE',
        }
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceBillingOwnerUpdate).toHaveBeenCalledWith({
      actingUserId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceOwnerId: 'owner-1',
      billingOwner: {
        type: 'user',
        userId: 'owner-1',
      },
    })
    expect(updateMock).toHaveBeenCalled()
    expect(await response.json()).toEqual({
      success: true,
      workspace: {
        id: 'workspace-1',
        ownerId: 'owner-1',
        name: 'Workspace 1',
        billingOwner: {
          type: 'user',
          userId: 'owner-1',
        },
      },
    })
  })
})
