/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowCheckpointSnapshot, WorkflowPausePoint } from './types'

const state = vi.hoisted(() => ({
  log: {} as Record<string, any>,
  lock: Promise.resolve() as Promise<unknown>,
  dispatchFails: false,
  admitted: [] as string[],
  enqueue: vi.fn(),
  readChild: vi.fn(),
  isCancellationRequested: vi.fn(),
  settleUsage: vi.fn(),
  notifyUsage: vi.fn(),
  children: [] as Record<string, any>[],
  authorizationRows: new Map<object, Record<string, unknown>[]>(),
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflow: { id: 'id', workspaceId: 'workspaceId' },
  workspace: { id: 'id', ownerId: 'ownerId' },
  permissions: {
    permissionType: 'permissionType',
    userId: 'userId',
    entityType: 'entityType',
    entityId: 'entityId',
  },
  user: {},
  workflowExecutionLogs: {
    id: 'id',
    executionId: 'executionId',
    workflowId: 'workflowId',
    workspaceId: 'workspaceId',
    endedAt: 'endedAt',
    executionData: 'executionData',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: (key: string, value: unknown) => (row: Record<string, unknown>) => row[key] === value,
  and:
    (...conditions: Array<(row: Record<string, unknown>) => boolean>) =>
    (row: Record<string, unknown>) =>
      conditions.every((condition) => condition(row)),
  isNull: (key: string) => (row: Record<string, unknown>) => row[key] === null,
  sql:
    (strings: TemplateStringsArray, ...values: unknown[]) =>
    (row: Record<string, any>) => {
      if (strings.join('').includes('queuedExecution')) {
        const expected = JSON.parse(values.at(-1) as string)
        const metadata = row.executionData.trigger?.data?.queuedExecution
        return (
          metadata?.source === expected.source &&
          metadata?.parentExecutionId === expected.parentExecutionId
        )
      }
      const [{ childExecutionId }] = JSON.parse(values.at(-1) as string)
      return row.executionData.checkpoint?.pausePoints.some(
        (point: WorkflowPausePoint) => point.childExecutionId === childExecutionId
      )
    },
}))
vi.mock('@tradinggoose/db', () => {
  const rows = () => [state.log, ...state.children]
  const store = {
    select: () => {
      let table: object
      let predicate = (_row: Record<string, unknown>) => true
      const read = () =>
        (table === workflowExecutionLogs ? rows() : state.authorizationRows.get(table)!).filter(
          predicate
        )
      const chain = {
        from: (value: object) => {
          table = value
          return chain
        },
        where: (value: typeof predicate) => {
          predicate = value
          return chain
        },
        for: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(read()).then(resolve),
      }
      return chain
    },
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async (predicate: (row: Record<string, unknown>) => boolean) =>
          rows()
            .filter(predicate)
            .map((row) => Object.assign(row, value)),
      }),
    }),
  }
  return {
    db: {
      ...store,
      transaction: async (callback: (tx: typeof store) => Promise<unknown>) => {
        const previous = state.lock
        let release = () => {}
        state.lock = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        const log = structuredClone(state.log)
        try {
          return await callback(store)
        } catch (error) {
          state.log = log
          throw error
        } finally {
          release()
        }
      },
    },
  }
})
vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: state.enqueue,
  isPendingWorkflowExecutionCancellationRequested: state.isCancellationRequested,
  PENDING_EXECUTION_CANCELLATION_ERROR: 'Workflow execution was cancelled',
}))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { API_KEY: 'api_key' } }))
vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionEventState: state.readChild,
}))
vi.mock('@/lib/utils-server', () => ({
  encryptSecret: async (value: string) => ({ encrypted: `encrypted:${value}` }),
  decryptSecret: async (value: string) => ({ decrypted: value.slice('encrypted:'.length) }),
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://studio.test' }))
vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    settleWorkflowExecutionUsage: state.settleUsage,
    notifyWorkflowUsage: state.notifyUsage,
  },
}))

import { db } from '@tradinggoose/db'
import { permissions, workflow, workflowExecutionLogs, workspace } from '@tradinggoose/db/schema'
import { createPublicExecutionResult } from '@/lib/workflows/execution-result'
import {
  claimWorkflowCheckpoint,
  completeWorkflowCheckpointChild,
  readWorkflowCheckpoint,
  readWorkflowCheckpointChildren,
  readWorkflowCheckpointSnapshot,
  reconcileWorkflowCheckpointChildren,
  recoverWorkflowCheckpointSegment,
  saveWorkflowCheckpoint,
  submitWorkflowCheckpoint,
} from './service'

const snapshot = {
  executor: { context: { blockLogs: [], metadata: { duration: 5000 } } },
  blueprint: { workflowId: 'workflow' },
  workflowLogId: 'log',
} as unknown as WorkflowCheckpointSnapshot
const point = (id: string): WorkflowPausePoint => ({
  id,
  blockId: id,
  blockName: id,
  kind: 'human',
  displayData: { review: 'visible' },
  inputFormat: [{ name: 'approved', type: 'boolean', required: true }],
  notification: [{ toolId: 'email', params: { apiKey: 'private' } }],
})
const childPoint = (): WorkflowPausePoint => ({
  ...point('child'),
  kind: 'child',
  inputFormat: [],
  childExecutionId: 'child-execution',
  childWorkflowId: 'child-workflow',
})
const save = (points = [point('first')], pendingExecutionId = 'execution') =>
  saveWorkflowCheckpoint({
    executionId: 'execution',
    pendingExecutionId,
    workflowId: 'workflow',
    workspaceId: 'workspace',
    userId: 'original',
    snapshot,
    pausePoints: points,
  })
const submit = (pausePointId = 'first', input: unknown = { approved: true }, revision = 1) =>
  submitWorkflowCheckpoint({
    executionId: 'execution',
    workflowId: 'workflow',
    workspaceId: 'workspace',
    reviewerId: 'reviewer',
    revision,
    pausePointId,
    input,
  })
const claim = () =>
  claimWorkflowCheckpoint({ executionId: 'execution', revision: 1, jobId: 'execution:resume:1' })

describe('durable workflow checkpoint lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.log = {
      id: 'log',
      executionId: 'execution',
      workflowId: 'workflow',
      workspaceId: 'workspace',
      endedAt: null,
      level: 'info',
      executionData: { environment: { userId: 'original' }, preserved: 'metadata' },
    }
    state.children = []
    state.authorizationRows.clear()
    state.authorizationRows.set(workflow, [{ id: 'workflow', workspaceId: 'workspace' }])
    state.authorizationRows.set(workspace, [{ id: 'workspace', ownerId: 'original' }])
    state.authorizationRows.set(permissions, [])
    state.lock = Promise.resolve()
    state.admitted = []
    state.dispatchFails = false
    state.readChild.mockResolvedValue(null)
    state.isCancellationRequested.mockResolvedValue(false)
    state.settleUsage.mockResolvedValue(undefined)
    state.notifyUsage.mockResolvedValue(undefined)
    state.enqueue.mockImplementation(async (args) => {
      const ready = await db.transaction(args.beforeEnqueue)
      if (ready && !state.admitted.includes(args.pendingExecutionId))
        state.admitted.push(args.pendingExecutionId)
      if (ready && state.dispatchFails) throw new Error('Dispatch failed')
      return { inserted: ready, pendingExecutionId: args.pendingExecutionId }
    })
  })

  it('stores encrypted snapshots and excludes notification credentials and reviewer IDs from review data', async () => {
    await save()
    expect(state.log.executionData.checkpoint?.encryptedSnapshot).toBe(
      `encrypted:${JSON.stringify(snapshot)}`
    )
    const view = await submit()
    expect(JSON.stringify(view)).not.toContain('private')
    expect(JSON.stringify(view)).not.toContain('notification')
    expect(JSON.stringify(view)).not.toContain('reviewerId')
    expect(state.log.executionData.checkpoint?.pausePoints[0].reviewerId).toBe('reviewer')
  })

  it('accounts completed work before exposing a pause, rolling back on ledger failure', async () => {
    state.settleUsage.mockImplementationOnce(async (_id, tx) => {
      expect(tx).toBeDefined()
      expect(state.log.totalDurationMs).toBe(5000)
      expect(state.log.executionData.traceSpans).toEqual([])
      expect(state.log.executionData.pause).toBeDefined()
      throw new Error('ledger unavailable')
    })
    await expect(save()).rejects.toThrow('ledger unavailable')
    expect(state.log.executionData.checkpoint).toBeUndefined()
    expect(state.log.executionData.pause).toBeUndefined()
    expect(state.notifyUsage).not.toHaveBeenCalled()
    await save()
    expect(state.log.executionData.pause.revision).toBe(1)
    expect(state.notifyUsage).toHaveBeenCalledOnce()
  })

  it('replays an already-accounted pause without another billing lookup', async () => {
    const paused = await save()
    state.settleUsage.mockRejectedValue(new Error('billing unavailable'))
    await expect(save()).resolves.toEqual(paused)
    expect(state.settleUsage).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'rejects a pause when cancellation wins the log lock (resumed: %s)',
    async (resumed) => {
      if (resumed) {
        await save()
        await submit()
        await claim()
      }
      const pendingExecutionId = resumed ? 'execution:resume:1' : 'execution'
      state.isCancellationRequested.mockResolvedValueOnce(true)
      await expect(save([point('first')], pendingExecutionId)).rejects.toThrow(
        'Workflow execution was cancelled'
      )
      expect(state.isCancellationRequested).toHaveBeenLastCalledWith(
        pendingExecutionId,
        expect.objectContaining({ select: expect.any(Function) })
      )
      expect(state.log.executionData).not.toHaveProperty('pause')
      expect(state.log.executionData.checkpoint?.revision).toBe(resumed ? 1 : undefined)
    }
  )

  it('reconstructs complete public pause links from the saved checkpoint log', async () => {
    const { createWorkflowExecutionResultFromLog } = await vi.importActual<
      typeof import('@/lib/execution/workflow-execution-events')
    >('@/lib/execution/workflow-execution-events')
    await save()
    const [row] = await db.select().from(workflowExecutionLogs)
    const { result } = createWorkflowExecutionResultFromLog(row)
    expect(createPublicExecutionResult(result!)).toEqual({
      success: true,
      status: 'paused',
      output: {
        url: 'https://studio.test/resume/workflow/execution',
        resumeEndpoint: 'https://studio.test/api/resume/workflow/execution',
        revision: 1,
      },
    })
  })

  it('waits for every pause point and admits one job using the original execution actor', async () => {
    await save([point('first'), point('parallel:second')])
    expect((await submit()).status).toBe('paused')
    expect(state.admitted).toEqual([])
    expect((await submit('parallel:second')).status).toBe('queued')
    expect(state.admitted).toEqual(['execution:resume:1'])
    expect(state.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: 'original',
        workspaceId: 'workspace',
        payload: {
          workflowId: 'workflow',
          userId: 'original',
          workspaceId: 'workspace',
          resumeExecutionId: 'execution',
          checkpointRevision: 1,
        },
      })
    )
  })

  it('joins child completion with human reviews without exposing a human submission path for child results', async () => {
    await save([point('first'), childPoint()])
    await completeWorkflowCheckpointChild({
      childExecutionId: 'child-execution',
      input: { success: true, output: { value: 1 } },
    })
    expect(state.admitted).toEqual([])
    await completeWorkflowCheckpointChild({
      childExecutionId: 'child-execution',
      input: { success: false },
    })
    expect(state.log.executionData.checkpoint?.pausePoints[1].input).toEqual({
      success: true,
      output: { value: 1 },
    })
    expect((await submit()).status).toBe('queued')
    expect(state.admitted).toEqual(['execution:resume:1'])
  })

  it('recovers child completion that preceded the parent commit and retries an accepted failed dispatch', async () => {
    await save([childPoint()])
    state.readChild.mockResolvedValue({
      status: 'completed',
      result: { success: true, output: { value: 1 } },
    })
    state.dispatchFails = true
    await expect(reconcileWorkflowCheckpointChildren('execution')).rejects.toThrow(
      'Dispatch failed'
    )
    expect((await readWorkflowCheckpoint('execution', 'workflow'))?.status).toBe('queued')
    state.dispatchFails = false
    expect(
      await recoverWorkflowCheckpointSegment({
        executionId: 'execution',
        workflowId: 'workflow',
        userId: 'original',
        checkpointRevision: 0,
      })
    ).toBe(true)
    expect(state.enqueue).toHaveBeenCalledTimes(2)
    expect(await claim()).not.toBeNull()
    expect(
      await recoverWorkflowCheckpointSegment({
        executionId: 'execution',
        workflowId: 'workflow',
        userId: 'original',
        checkpointRevision: 1,
      })
    ).toBe(false)
  })

  it('does not let a stale child-completion notification fail a newer checkpoint', async () => {
    await save([childPoint()])
    const enqueue = state.enqueue.getMockImplementation()!
    state.enqueue.mockImplementationOnce(async (args) => {
      state.log.executionData.checkpoint!.revision = 2
      return enqueue(args)
    })
    await completeWorkflowCheckpointChild({
      childExecutionId: 'child-execution',
      input: { success: true },
    })
    expect(state.log.executionData.checkpoint?.pausePoints[0].input).toBeUndefined()
    expect(state.admitted).toEqual([])
  })

  it('accepts concurrent duplicates once, never overwrites accepted input, and allows only one claim', async () => {
    await save()
    await Promise.all([submit('first', { approved: true }), submit('first', { approved: false })])
    expect(state.log.executionData.checkpoint?.pausePoints[0].input).toEqual({ approved: true })
    expect(state.admitted).toHaveLength(1)
    const claimed = await Promise.all([claim(), claim()])
    expect(claimed.filter(Boolean)).toHaveLength(1)
    expect(claimed.find(Boolean)?.userId).toBe('original')
    expect(claimed.find(Boolean)?.snapshot).toEqual(snapshot)
  })

  it('allows a duplicate submission to wake an admitted job after dispatch failure', async () => {
    await save()
    state.dispatchFails = true
    await expect(submit()).rejects.toThrow('Dispatch failed')
    expect((await readWorkflowCheckpoint('execution', 'workflow'))?.status).toBe('queued')
    state.dispatchFails = false
    expect((await submit('first', { approved: false })).status).toBe('queued')
    expect(state.log.executionData.checkpoint?.pausePoints[0].input).toEqual({ approved: true })
    expect(await claim()).not.toBeNull()
  })

  it('rolls back invalid input, rejects child impersonation and scopes reads to the workspace', async () => {
    await save([point('first'), childPoint()])
    await expect(submit('first', { approved: 'yes' })).rejects.toThrow('must be boolean')
    await expect(submit('child')).rejects.toThrow('cannot be submitted')
    expect(
      state.log.executionData.checkpoint?.pausePoints.every(
        (item: WorkflowPausePoint) => item.input === undefined
      )
    ).toBe(true)
    expect(await readWorkflowCheckpoint('execution', 'workflow', 'other')).toBeNull()
    expect(await readWorkflowCheckpoint('execution', 'other', 'workspace')).toBeNull()
    expect(state.admitted).toEqual([])
  })

  it('increments revision when the same block pauses again and rejects stale submissions', async () => {
    await save()
    await submit()
    await claim()
    expect((await save()).revision).toBe(2)
    await expect(submit()).rejects.toThrow('older checkpoint')
    expect(state.log.executionData.checkpoint?.pausePoints[0].input).toBeUndefined()
    expect((await submit('first', { approved: false }, 2)).status).toBe('queued')
  })

  it.each(['owner', 'write', 'read', 'none'])(
    'authorizes %s access on the claim connection without borrowing from an exhausted pool',
    async (permission) => {
      await save()
      await submit()
      state.authorizationRows.set(workspace, [
        { id: 'workspace', ownerId: permission === 'owner' ? 'original' : 'other' },
      ])
      if (permission === 'read' || permission === 'write') {
        state.authorizationRows.set(permissions, [
          {
            userId: 'original',
            entityType: 'workspace',
            entityId: 'workspace',
            permissionType: permission,
          },
        ])
      }
      const pool = vi.spyOn(db, 'select').mockImplementation(() => {
        throw new Error('No pool connections available outside the claim transaction')
      })
      try {
        if (permission === 'owner' || permission === 'write') {
          await expect(claim()).resolves.toMatchObject({ userId: 'original', snapshot })
        } else {
          await expect(claim()).rejects.toThrow('no longer has workflow access')
        }
        expect(pool).not.toHaveBeenCalled()
      } finally {
        pool.mockRestore()
      }
      if (permission === 'read' || permission === 'none') {
        expect((await readWorkflowCheckpoint('execution', 'workflow'))?.status).toBe('queued')
      }
    }
  )

  it('uses existing terminal log state after logger cleanup without reviving a checkpoint', async () => {
    state.log.endedAt = new Date()
    await expect(save()).rejects.toThrow('already terminal')
    expect(state.log.executionData.checkpoint).toBeUndefined()
    state.log.endedAt = null
    await save()
    await submit()
    state.log.endedAt = new Date()
    expect(await claim()).toBeNull()
    const { checkpoint: _checkpoint, pause: _pause, ...completedData } = state.log.executionData
    state.log.executionData = completedData
    state.log.level = 'error'
    state.log.executionData.errorMessage = 'Workflow execution was cancelled'
    expect(await readWorkflowCheckpoint('execution', 'workflow')).toMatchObject({
      status: 'cancelled',
      revision: 0,
      pausePoints: [],
    })
    expect(await readWorkflowCheckpointSnapshot('execution')).toBeNull()
    await expect(save()).rejects.toThrow('already terminal')
  })

  it('keeps cancellation frozen without losing recovery costs or original log metadata', async () => {
    await save()
    const { pause: _pause, ...cancelledData } = state.log.executionData
    state.log.executionData = cancelledData
    expect(await claim()).toBeNull()
    await expect(submit()).rejects.toThrow('no longer awaiting input')
    await expect(save()).rejects.toThrow('being cancelled')
    expect(await readWorkflowCheckpointSnapshot('execution')).toEqual(snapshot)
    expect(state.log.executionData.preserved).toBe('metadata')
  })

  it('finds unfinished children from canonical trigger metadata even without a parent checkpoint', async () => {
    const child = {
      executionId: 'child',
      endedAt: null,
      executionData: {
        environment: { userId: 'original' },
        trigger: {
          data: { queuedExecution: { source: 'workflow_block', parentExecutionId: 'execution' } },
        },
      },
    }
    state.children = [
      child,
      { ...child, executionId: 'ended-child', endedAt: new Date() },
      { ...child, executionId: 'other-child', executionData: { environment: { userId: 'other' } } },
    ]
    expect(await readWorkflowCheckpointChildren('execution')).toEqual([
      { id: 'child', userId: 'original' },
    ])
    expect(state.log.executionData.checkpoint).toBeUndefined()
  })
})
