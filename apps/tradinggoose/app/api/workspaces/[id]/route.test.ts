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
const drainHarness = vi.hoisted(() => ({
  events: [] as string[],
  active: false,
  delete: vi.fn(),
  fenced: vi.fn(),
  lockList: vi.fn(),
  logs: [] as Array<{ id: string; workspaceId: string; executionId: string; files: unknown[] }>,
  assets: vi.fn(),
  memories: vi.fn(),
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
  workflowExecutionLogs: {
    id: 'logs.id',
    workspaceId: 'logs.workspaceId',
    executionId: 'logs.executionId',
    endedAt: 'logs.endedAt',
  },
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
  },
  workspace: {
    id: 'workspace.id',
  },
}))

vi.mock('@/lib/logs/execution/cleanup', () => ({ deleteExecutionLogAssets: drainHarness.assets }))
vi.mock('@/lib/mastra/workflow-memory', () => ({ deleteWorkflowMemories: drainHarness.memories }))

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
  lockSavedEntityList: drainHarness.lockList,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  runYjsDrainFencedTransaction: drainHarness.fenced,
  SocketServerBridgeError: class SocketServerBridgeError extends Error {},
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
    drainHarness.events.length = 0
    drainHarness.active = false
    drainHarness.logs = []
    drainHarness.assets.mockReset().mockResolvedValue(undefined)
    drainHarness.memories.mockReset().mockResolvedValue(undefined)
    drainHarness.delete.mockReturnValue({ where: vi.fn() })
    drainHarness.lockList.mockResolvedValue(undefined)
    drainHarness.fenced.mockImplementation(async (_target, mutate) => {
      drainHarness.events.push('fence-begin')
      const query = {
        from: () => query,
        where: () => query,
        for: async () => [],
        limit: async () => (drainHarness.active ? [{ id: 'active' }] : []),
        then: (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(drainHarness.logs).then(resolve),
      }
      const result = await mutate({ delete: drainHarness.delete, select: () => query })
      drainHarness.events.push('fence-commit')
      return result
    })
  })

  it('fences every workspace document while deleting canonical rows', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(new NextRequest('http://localhost/api/workspaces/workspace-1'), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(200)
    expect(drainHarness.fenced.mock.calls[0]?.[0]).toEqual({ workspaceIds: ['workspace-1'] })
    expect(drainHarness.events).toEqual(['fence-begin', 'fence-commit'])
    expect(drainHarness.lockList).toHaveBeenCalledTimes(2)
    expect(drainHarness.delete).toHaveBeenCalledTimes(4)
  })

  it('keeps a workspace with active workflow executions and its native history intact', async () => {
    drainHarness.active = true
    const { DELETE } = await import('./route')
    const response = await DELETE(new NextRequest('http://localhost/api/workspaces/workspace-1'), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })
    expect(response.status).toBe(409)
    expect(drainHarness.delete).not.toHaveBeenCalled()
    expect(drainHarness.assets).not.toHaveBeenCalled()
    expect(drainHarness.memories).not.toHaveBeenCalled()
  })

  it.each(['assets', 'memories'] as const)(
    'keeps workspace ownership after failed %s cleanup and retries before cascade',
    async (phase) => {
      const log = { id: 'log', workspaceId: 'workspace-1', executionId: 'execution', files: [] }
      drainHarness.logs = [log]
      drainHarness[phase].mockRejectedValueOnce(new Error('Native storage unavailable'))
      const { DELETE } = await import('./route')
      const request = () =>
        DELETE(new NextRequest('http://localhost/api/workspaces/workspace-1'), {
          params: Promise.resolve({ id: 'workspace-1' }),
        })
      expect((await request()).status).toBe(500)
      expect(drainHarness.events).toEqual(['fence-begin'])
      // The workflow delete remains uncommitted; parent/cascading deletes were never reached.
      expect(drainHarness.delete).toHaveBeenCalledTimes(1)
      expect((await request()).status).toBe(200)
      expect(drainHarness.events).toEqual(['fence-begin', 'fence-begin', 'fence-commit'])
      expect(drainHarness.assets).toHaveBeenLastCalledWith(log)
      expect(drainHarness.memories).toHaveBeenCalledWith('workspace-1')
      expect(drainHarness.delete).toHaveBeenCalledTimes(5)
      const cascade = drainHarness.delete.mock.invocationCallOrder.at(-1)!
      expect(drainHarness.assets.mock.invocationCallOrder.at(-1)!).toBeLessThan(cascade)
      expect(drainHarness.memories.mock.invocationCallOrder.at(-1)!).toBeLessThan(cascade)
    }
  )

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
