import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  provisionLayout: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@tradinggoose/db/schema', () => ({
  permissions: {
    userId: 'permissions.userId',
    entityType: 'permissions.entityType',
    entityId: 'permissions.entityId',
  },
  workspace: {},
}))
vi.mock('@/lib/dashboard-layouts/operations', () => ({
  provisionDashboardLayoutForWorkspaceUserInTx: mocks.provisionLayout,
}))

import { grantWorkspaceAccessInTx } from './service'

describe('grantWorkspaceAccessInTx', () => {
  beforeEach(() => {
    mocks.provisionLayout.mockReset()
    mocks.provisionLayout.mockResolvedValue(true)
  })

  it('provisions the reader-owned default layout in the access-grant transaction', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const tx = {
      insert: vi.fn(() => ({ values })),
    }

    await grantWorkspaceAccessInTx(tx as never, {
      workspaceId: 'workspace-1',
      userId: 'reader-1',
      permissionType: 'read',
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'reader-1',
        entityType: 'workspace',
        entityId: 'workspace-1',
        permissionType: 'read',
      })
    )
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: ['permissions.userId', 'permissions.entityType', 'permissions.entityId'],
      set: {
        permissionType: expect.anything(),
        updatedAt: expect.any(Date),
      },
    })
    expect(mocks.provisionLayout).toHaveBeenCalledWith(tx, {
      workspaceId: 'workspace-1',
      ownerUserId: 'reader-1',
    })
    expect(values.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.provisionLayout.mock.invocationCallOrder[0]!
    )
  })

  it.each(['read', 'write', 'admin'] as const)(
    'atomically merges an invited %s grant with the existing permission',
    async (permissionType) => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
      const tx = {
        insert: vi.fn(() => ({
          values: vi.fn(() => ({ onConflictDoUpdate })),
        })),
      }

      await grantWorkspaceAccessInTx(tx as never, {
        workspaceId: 'workspace-1',
        userId: 'member-1',
        permissionType,
      })

      expect(onConflictDoUpdate).toHaveBeenCalledWith({
        target: ['permissions.userId', 'permissions.entityType', 'permissions.entityId'],
        set: {
          permissionType: expect.anything(),
          updatedAt: expect.any(Date),
        },
      })
      expect(tx).not.toHaveProperty('delete')
      expect(mocks.provisionLayout).toHaveBeenCalledWith(tx, {
        workspaceId: 'workspace-1',
        ownerUserId: 'member-1',
      })
    }
  )
})
