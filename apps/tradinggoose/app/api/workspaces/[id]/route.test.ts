/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const {
  mockGetSession,
  mockGetUserEntityPermissions,
  mockGetWorkspaceById,
  mockResolveWorkspaceBillingOwnerUpdate,
  mockToWorkspaceApiRecord,
  mockUpdateWhere,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockResolveWorkspaceBillingOwnerUpdate: vi.fn(),
  mockToWorkspaceApiRecord: vi.fn((workspace) => workspace),
  mockUpdateWhere: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))
const deletionHarness = vi.hoisted(() => ({
  events: [] as string[],
  delete: vi.fn(),
  fenced: vi.fn(),
  lease: vi.fn(),
  lockList: vi.fn(),
}))

const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
  },
  knowledgeBase: {},
  permissions: {},
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
  },
  workspace: {
    id: 'workspace.id',
  },
}))

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    ...actual,
    eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: (...args: unknown[]) => mockGetUserEntityPermissions(...args),
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
}))

vi.mock('@/lib/workspaces/billing-owner', () => {
  class WorkspaceBillingOwnerUpdateError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkspaceBillingOwnerUpdateError'
    }
  }

  return {
    WorkspaceBillingOwnerUpdateError,
    workspaceBillingOwnerSchema: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().trim().min(1),
      }),
      z.object({
        type: z.literal('organization'),
        organizationId: z.string().trim().min(1),
      }),
    ]),
    resolveWorkspaceBillingOwnerUpdate: (...args: unknown[]) =>
      mockResolveWorkspaceBillingOwnerUpdate(...args),
    toWorkspaceApiRecord: (workspace: unknown) => mockToWorkspaceApiRecord(workspace),
  }
})

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

vi.mock('@/lib/workspaces/service', () => ({
  getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'workspace-1' }, { id: 'workspace-2' }]),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  SAVED_ENTITY_LIST_LOCK_KINDS: ['workflow', 'watchlist'],
  lockSavedEntityList: deletionHarness.lockList,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  runYjsDeletionFencedTransaction: deletionHarness.fenced,
  SocketServerBridgeError: class SocketServerBridgeError extends Error {},
  withYjsSessionDeletionLease: deletionHarness.lease,
}))

describe('Workspace by id PATCH route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWorkspaceById.mockResolvedValue({ id: 'workspace-1', ownerId: 'user-1' })
    mockResolveWorkspaceBillingOwnerUpdate.mockReset()
    mockUpdateWhere.mockReset()
    mockUpdateSet.mockClear()
    deletionHarness.events.length = 0
    deletionHarness.delete.mockReturnValue({ where: vi.fn() })
    deletionHarness.lockList.mockResolvedValue(undefined)
    deletionHarness.lease.mockImplementation(async (_target, mutate) => {
      deletionHarness.events.push('lease-begin')
      const result = await mutate({ assertHeld: vi.fn() })
      deletionHarness.events.push('lease-commit')
      return result
    })
    deletionHarness.fenced.mockImplementation(async (_leases, mutate) => {
      deletionHarness.events.push('transaction')
      return mutate({ delete: deletionHarness.delete })
    })
  })

  it('leases every workspace document before deleting canonical rows', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(new NextRequest('http://localhost/api/workspaces/workspace-1'), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(200)
    expect(deletionHarness.lease.mock.calls[0]?.[0]).toEqual({ workspaceIds: ['workspace-1'] })
    expect(deletionHarness.events).toEqual(['lease-begin', 'transaction', 'lease-commit'])
    expect(deletionHarness.lockList).toHaveBeenCalledTimes(2)
    expect(deletionHarness.delete).toHaveBeenCalledTimes(4)
  })

  it('returns 500 when the workspace update fails unexpectedly', async () => {
    mockGetWorkspaceById.mockResolvedValue({
      id: 'workspace-1',
      ownerId: 'owner-1',
    })
    mockUpdateWhere.mockRejectedValue(new Error('database offline'))

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated workspace' }),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to update workspace' })
  })

  it('keeps billing owner validation errors as 400 responses', async () => {
    const { WorkspaceBillingOwnerUpdateError } = await import('@/lib/workspaces/billing-owner')

    mockGetWorkspaceById.mockResolvedValue({
      id: 'workspace-1',
      ownerId: 'owner-1',
    })
    mockResolveWorkspaceBillingOwnerUpdate.mockRejectedValue(
      new WorkspaceBillingOwnerUpdateError('Workspace billing owner user must have admin access')
    )

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1', {
        method: 'PATCH',
        body: JSON.stringify({
          billingOwner: {
            type: 'user',
            userId: 'user-2',
          },
        }),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Workspace billing owner user must have admin access',
    })
  })
})
