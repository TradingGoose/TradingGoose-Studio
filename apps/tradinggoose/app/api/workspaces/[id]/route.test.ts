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
  select: vi.fn(),
  delete: vi.fn(),
  fenced: vi.fn(),
  lockList: vi.fn(),
  logs: [] as Record<string, any>[],
  terminalize: vi.fn(),
  settleUsage: vi.fn(),
  assets: vi.fn(),
  memories: vi.fn(),
}))

const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: drainHarness.select,
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
    workflowId: 'logs.workflowId',
    endedAt: 'logs.endedAt',
    workflowSummary: 'logs.workflowSummary',
    executionData: 'logs.executionData',
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
vi.mock('@/background/pending-execution-worker', () => ({
  terminalizeWorkflowExecution: drainHarness.terminalize,
}))
vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: { settleWorkflowExecutionUsage: drainHarness.settleUsage },
}))

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    ...actual,
    eq: (field: string, value: unknown) => (row: Record<string, unknown>) =>
      row[field.split('.').at(-1)!] === value,
    isNull: (field: string) => (row: Record<string, unknown>) =>
      row[field.split('.').at(-1)!] === null,
    and:
      (...conditions: Array<(row: Record<string, unknown>) => boolean>) =>
      (row: Record<string, unknown>) =>
        conditions.every((condition) => condition(row)),
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

const executionLog = () => ({
  id: 'log',
  workspaceId: 'workspace-1',
  executionId: 'execution',
  files: [],
  workflowId: null,
  endedAt: null as Date | null,
  workflowSummary: { id: 'deleted-workflow' },
  executionData: {
    environment: { userId: 'original-actor' },
    pause: { revision: 1 },
    checkpoint: { revision: 1, activeJobId: null },
    billing: { billable: false },
  },
})

async function deleteWorkspace() {
  const { DELETE } = await import('./route')
  return DELETE(new NextRequest('http://localhost/api/workspaces/workspace-1'), {
    params: Promise.resolve({ id: 'workspace-1' }),
  })
}

describe('Workspace by id route', () => {
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
    drainHarness.logs = []
    drainHarness.settleUsage.mockReset().mockResolvedValue(undefined)
    drainHarness.terminalize.mockReset().mockImplementation(async ({ id }) => {
      drainHarness.logs.find((log) => log.executionId === id)!.endedAt = new Date()
    })
    drainHarness.assets.mockReset().mockResolvedValue(undefined)
    drainHarness.memories.mockReset().mockResolvedValue(undefined)
    drainHarness.delete.mockReturnValue({ where: vi.fn() })
    drainHarness.lockList.mockResolvedValue(undefined)
    drainHarness.select.mockImplementation(() => {
      let rows = drainHarness.logs
      let predicate = (_row: Record<string, unknown>) => true
      let limit = Number.POSITIVE_INFINITY
      const query = {
        from: (table: { id: string }) => {
          if (table.id === 'workspace.id') rows = [{ id: 'workspace-1' }]
          return query
        },
        where: (value: typeof predicate) => {
          predicate = value
          return query
        },
        for: () => query,
        limit: (value: number) => {
          limit = value
          return query
        },
        then: (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(rows.filter(predicate).slice(0, limit)).then(resolve),
      }
      return query
    })
    drainHarness.fenced.mockImplementation(async (_target, mutate) => {
      drainHarness.events.push('fence-begin')
      const result = await mutate({ delete: drainHarness.delete, select: drainHarness.select })
      drainHarness.events.push('fence-commit')
      return result
    })
  })

  it('fences every workspace document while deleting canonical rows', async () => {
    const response = await deleteWorkspace()

    expect(response.status).toBe(200)
    expect(drainHarness.fenced.mock.calls[0]?.[0]).toEqual({ workspaceIds: ['workspace-1'] })
    expect(drainHarness.events).toEqual(['fence-begin', 'fence-commit'])
    expect(drainHarness.lockList).toHaveBeenCalledTimes(2)
    expect(drainHarness.delete).toHaveBeenCalledTimes(4)
  })

  it('requires workspace admin before recovering retained executions', async () => {
    drainHarness.logs = [executionLog()]
    mockGetUserEntityPermissions.mockResolvedValue('write')
    const response = await deleteWorkspace()
    expect(response.status).toBe(403)
    expect(drainHarness.terminalize).not.toHaveBeenCalled()
    expect(drainHarness.fenced).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'keeps unfinished execution history (workflow deleted: %s)',
    async (deleted) => {
      const log = executionLog()
      const { pause: _pause, ...running } = log.executionData
      drainHarness.logs = [
        {
          ...log,
          workflowId: deleted ? null : 'live-workflow',
          executionData: deleted
            ? { ...running, checkpoint: { ...running.checkpoint, activeJobId: 'resume-job' } }
            : log.executionData,
        },
      ]
      const response = await deleteWorkspace()
      expect(response.status).toBe(409)
      expect(drainHarness.delete).not.toHaveBeenCalled()
      expect(drainHarness.assets).not.toHaveBeenCalled()
      expect(drainHarness.memories).not.toHaveBeenCalled()
      expect(drainHarness.terminalize).not.toHaveBeenCalled()
    }
  )

  it('finishes a deleted workflow pause under its original actor before workspace deletion', async () => {
    const log = executionLog()
    const foreign = {
      ...executionLog(),
      id: 'foreign',
      executionId: 'foreign',
      workspaceId: 'workspace-2',
    }
    drainHarness.logs = [log, foreign]
    const response = await deleteWorkspace()
    expect(response.status).toBe(200)
    expect(drainHarness.terminalize).toHaveBeenCalledOnce()
    expect(drainHarness.terminalize.mock.calls[0][0]).toMatchObject({
      id: 'execution',
      workflowId: 'deleted-workflow',
      workspaceId: 'workspace-1',
      userId: 'original-actor',
      executionType: 'workflow',
      source: 'human_in_the_loop',
      payload: { resumeExecutionId: 'execution' },
    })
    expect(drainHarness.terminalize.mock.calls[0][3]).toBe(false)
    expect(foreign.endedAt).toBeNull()
    expect(drainHarness.terminalize.mock.invocationCallOrder[0]).toBeLessThan(
      drainHarness.fenced.mock.invocationCallOrder[0]
    )
    expect(drainHarness.settleUsage).toHaveBeenCalledExactlyOnceWith(
      'execution',
      expect.objectContaining({ select: drainHarness.select })
    )
    expect(drainHarness.settleUsage.mock.invocationCallOrder[0]).toBeLessThan(
      drainHarness.assets.mock.invocationCallOrder[0]
    )
    expect(drainHarness.delete).toHaveBeenCalledTimes(4)
  })

  it.each(['before completion', 'after completion', 'settlement'])(
    'retains execution ownership after failure during %s and retries deletion',
    async (phase) => {
      const log = executionLog()
      drainHarness.logs = [log]
      if (phase === 'settlement')
        drainHarness.settleUsage.mockRejectedValueOnce(new Error('Ledger unavailable'))
      else
        drainHarness.terminalize.mockImplementationOnce(async () => {
          if (phase === 'after completion') log.endedAt = new Date()
          throw new Error('Finalization unavailable')
        })
      expect((await deleteWorkspace()).status).toBe(500)
      expect(drainHarness.delete).not.toHaveBeenCalled()
      expect(drainHarness.events).not.toContain('fence-commit')
      expect(drainHarness.assets).not.toHaveBeenCalled()
      expect(drainHarness.memories).not.toHaveBeenCalled()
      expect((await deleteWorkspace()).status).toBe(200)
      expect(drainHarness.terminalize).toHaveBeenCalledTimes(2)
      expect(drainHarness.delete).toHaveBeenCalledTimes(4)
    }
  )

  it.each(['assets', 'memories'] as const)(
    'keeps workspace ownership after failed %s cleanup and retries before cascade',
    async (phase) => {
      const log = { ...executionLog(), endedAt: new Date() }
      drainHarness.logs = [log]
      drainHarness[phase].mockRejectedValueOnce(new Error('Native storage unavailable'))
      expect((await deleteWorkspace()).status).toBe(500)
      expect(drainHarness.events).toEqual(['fence-begin'])
      // The workflow delete remains uncommitted; parent/cascading deletes were never reached.
      expect(drainHarness.delete).toHaveBeenCalledTimes(1)
      expect((await deleteWorkspace()).status).toBe(200)
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
