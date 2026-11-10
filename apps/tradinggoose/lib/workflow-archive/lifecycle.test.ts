import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativePayloadRef } from '@/lib/mastra/workflow-history'
import { type ArchiveReference, functionalDigest } from './format'

const fixture = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  txSelect: vi.fn(),
  execute: vi.fn(),
  delete: vi.fn(),
  native: vi.fn(),
  nativeLookup: vi.fn(),
  nativeDelete: vi.fn(),
  readArchive: vi.fn(),
  writeArchive: vi.fn(),
  projectHistorical: vi.fn(),
  future: vi.fn(),
  access: vi.fn(),
  permission: vi.fn(),
  update: vi.fn(),
  writes: [] as unknown[],
  events: [] as string[],
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: fixture.select,
    transaction: fixture.transaction,
    delete: fixture.delete,
  },
}))
vi.mock('@tradinggoose/db/schema', () => ({
  workspace: { id: 'workspace.id' },
  workflowExecutionLogs: {
    id: 'logs.id',
    workspaceId: 'logs.workspaceId',
    executionId: 'logs.executionId',
  },
  pendingExecution: { id: 'queue.id', workspaceId: 'queue.workspaceId', status: 'queue.status' },
  workflowLogWebhookDelivery: {
    id: 'delivery.id',
    executionId: 'delivery.executionId',
    status: 'delivery.status',
  },
  orderHistoryTable: { id: 'order.id', logId: 'order.logId' },
  workflowExecutionSnapshots: { id: 'snapshots.id', workspaceId: 'snapshots.workspaceId' },
}))
vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionResultFromLog: fixture.future,
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: fixture.permission }))
vi.mock('@/lib/mastra/runtime', () => ({ getNativeMemoryStore: fixture.native }))
vi.mock('@/lib/mastra/workflow-history', () => ({
  readFunctionalPayload: vi.fn(),
  readNativePayloadMessages: vi.fn(),
  workflowAgentPayloadResource: vi.fn(),
}))
vi.mock('@/lib/utils-server', () => ({ decryptSecret: vi.fn() }))
vi.mock('@/executor/checkpoint', () => ({
  restoreExecutionContext: vi.fn(),
  saveExecutionContext: vi.fn(),
}))
vi.mock('./functional', () => ({
  FUNCTIONAL_OUTPUT_REFERENCE: { purpose: 'workflow-functional-output' },
  assertRetainedLogAccess: fixture.access,
  hydrateFunctionalBlocks: vi.fn(),
  projectFunctionalBlocks: vi.fn(),
}))
vi.mock('./historical', () => ({ projectHistoricalFunctionalPayload: fixture.projectHistorical }))
vi.mock('./io', () => ({
  readPrivateArchive: fixture.readArchive,
  writePrivateArchive: fixture.writeArchive,
}))

import {
  ArchiveBusyError,
  ArchivePruneDeferredError,
  assertWorkspaceArchiveDeletionInTx,
  deleteArchivedWorkflowLog,
  preserveHistoricalWorkflowPayload,
  pruneArchivedWorkflowPayload,
} from './lifecycle'

// These seams establish application call ordering and zero native/deletion contact only.
// Canonical FK serialization and archive bytes/readability have separate real-PG coverage.
const reference: ArchiveReference = {
  version: 1,
  purpose: 'workflow-archive',
  provider: 'local',
  workspaceId: 'workspace-a',
  executionId: 'execution-a',
  logId: 'log-a',
  key: 'archive/a',
  digest: 'verified-artifact-digest',
}
const nativeReference: NativePayloadRef = {
  version: 1,
  purpose: 'workflow-agent',
  workspaceId: reference.workspaceId,
  executionId: reference.executionId,
  logId: reference.logId,
  blockId: 'agent',
  runId: 'run-a',
  threadId: 'native-thread-a',
  resourceId: 'native-resource-a',
  messageIds: ['message-a'],
  digest: 'native-digest',
}
const log = () => ({
  id: reference.logId,
  workspaceId: reference.workspaceId,
  executionId: reference.executionId,
  endedAt: new Date(0),
  executionData: { workflowArchive: reference },
})
const archive = (row: ReturnType<typeof log>, entries = [{ reference: nativeReference }]) => ({
  sourceFingerprint: functionalDigest({
    ...row,
    executionData: { ...row.executionData, workflowArchive: undefined },
  }),
  nativeThreads: entries,
})
function query<T>(rows: T[], stage = 'read') {
  const result = { from: vi.fn(), where: vi.fn(), limit: vi.fn() }
  const promise = Promise.resolve(rows)
  result.from.mockReturnValue(result)
  result.where.mockReturnValue(result)
  result.limit.mockReturnValue({
    then: promise.then.bind(promise),
    for: vi.fn(async (mode: string) => {
      fixture.events.push(`${stage}.lock:${mode}`)
      return rows
    }),
  })
  return result
}
const tx = { select: fixture.txSelect, execute: fixture.execute, update: fixture.update }
function eligible(row = log(), entries = [{ reference: nativeReference }]) {
  fixture.select.mockReturnValue(query([row]))
  fixture.readArchive.mockResolvedValue(archive(row, entries))
  fixture.txSelect.mockReturnValue(query([])).mockReturnValueOnce(query([row], 'log'))
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.events.length = 0
  fixture.writes.length = 0
  fixture.permission.mockReset().mockResolvedValue({ hasAccess: true })
  fixture.access.mockReset().mockResolvedValue(undefined)
  fixture.future.mockReset()
  fixture.update.mockImplementation(() => ({
    set: (values: unknown) => ({
      where: async () => {
        fixture.writes.push(values)
      },
    }),
  }))
  fixture.select.mockReset()
  fixture.txSelect.mockReset()
  fixture.execute.mockReset().mockImplementation(async () => {
    fixture.events.push('isolation.read')
    return [{ transaction_isolation: 'read committed' }]
  })
  fixture.transaction.mockImplementation(
    async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)
  )
  fixture.native.mockResolvedValue({
    getThreadById: fixture.nativeLookup,
    deleteThread: fixture.nativeDelete,
  })
  fixture.nativeLookup.mockResolvedValue(null)
  vi.stubEnv('WORKFLOW_ADMISSIONS_CLOSED', 'true')
})
afterEach(() => vi.unstubAllEnvs())
function expectNoDestructiveContact() {
  expect(fixture.native).not.toHaveBeenCalled()
  expect(fixture.nativeLookup).not.toHaveBeenCalled()
  expect(fixture.nativeDelete).not.toHaveBeenCalled()
  expect(fixture.delete).not.toHaveBeenCalled()
}

describe('archive prune without a verified producer join', () => {
  it.each([
    { name: 'recorded native payload', entries: [{ reference: nativeReference }] },
    { name: 'empty archived native membership', entries: [] },
  ])('defers $name before any native lookup or deletion', async ({ entries }) => {
    eligible(log(), entries)
    await expect(pruneArchivedWorkflowPayload(reference.logId)).rejects.toBeInstanceOf(
      ArchivePruneDeferredError
    )
    expect(fixture.events).toContain('log.lock:update')
    expectNoDestructiveContact()
  })

  it.each([
    { condition: sql`true`, name: 'true' },
    { condition: undefined, name: 'omitted' },
  ])(
    'defers eligible SQL retention with $name predicate even if native lookup would be absent',
    async ({ condition }) => {
      eligible()
      await expect(deleteArchivedWorkflowLog(reference.logId, condition)).rejects.toBeInstanceOf(
        ArchivePruneDeferredError
      )
      expect(fixture.events).toContain('log.lock:update')
      expectNoDestructiveContact()
    }
  )

  it('returns false from locked ineligibility without interpreting native absence', async () => {
    eligible()
    const filtered = query([], 'retention')
    fixture.txSelect.mockReset().mockReturnValueOnce(filtered)
    const condition = sql`false`
    expect(await deleteArchivedWorkflowLog(reference.logId, condition)).toBe(false)
    expect(filtered.where).toHaveBeenCalledOnce()
    expect(fixture.events).toEqual(['retention.lock:update'])
    expect(fixture.txSelect).toHaveBeenCalledOnce()
    expectNoDestructiveContact()
  })

  it('keeps the changed-source refusal before the deferred outcome', async () => {
    eligible()
    fixture.txSelect
      .mockReset()
      .mockReturnValueOnce(query([{ ...log(), endedAt: new Date(1) }], 'log'))
    await expect(pruneArchivedWorkflowPayload(reference.logId)).rejects.toThrow('handoff changed')
    expectNoDestructiveContact()
  })

  it('keeps consumer pins before deferred cleanup', async () => {
    eligible()
    fixture.txSelect
      .mockReset()
      .mockReturnValueOnce(query([log()], 'log'))
      .mockReturnValueOnce(query([{ id: 'pending-consumer' }]))
      .mockReturnValue(query([]))
    await expect(pruneArchivedWorkflowPayload(reference.logId)).rejects.toThrow('still required')
    expectNoDestructiveContact()
  })

  it('rejects a mismatched archived native scope before deferral', async () => {
    eligible(log(), [{ reference: { ...nativeReference, workspaceId: 'other-workspace' } }])
    await expect(pruneArchivedWorkflowPayload(reference.logId)).rejects.toThrow('scope mismatch')
    expectNoDestructiveContact()
  })

  it('is actionable through the existing archive busy response', () => {
    const error = new ArchivePruneDeferredError()
    expect(error).toBeInstanceOf(ArchiveBusyError)
    expect(error.status).toBe(409)
    expect(error.message).toContain('quiescence')
  })
})

describe('workspace archive guard at the real cascade transaction', () => {
  it('locks the parent before separately checking any retained log, preserving the empty path', async () => {
    fixture.txSelect
      .mockImplementationOnce(() => query([{ id: reference.workspaceId }], 'workspace'))
      .mockImplementationOnce(() => {
        fixture.events.push('retained-log.read')
        return query([])
      })
    await assertWorkspaceArchiveDeletionInTx(tx, reference.workspaceId)
    expect(fixture.events).toEqual(['isolation.read', 'workspace.lock:update', 'retained-log.read'])
    expectNoDestructiveContact()
  })

  it.each([
    { label: 'active', endedAt: null },
    { label: 'terminal', endedAt: new Date(0) },
    { label: 'archived', endedAt: new Date(0), executionData: { workflowArchive: reference } },
  ])('defers any retained $label log with admissions closed', async (retained) => {
    fixture.txSelect
      .mockReturnValueOnce(query([{ id: reference.workspaceId }], 'workspace'))
      .mockReturnValueOnce(query([{ id: reference.logId, ...retained }]))
    await expect(
      assertWorkspaceArchiveDeletionInTx(tx, reference.workspaceId)
    ).rejects.toBeInstanceOf(ArchivePruneDeferredError)
    expect(fixture.events).toEqual(['isolation.read', 'workspace.lock:update'])
    expectNoDestructiveContact()
  })

  it.each(['repeatable read', 'serializable', 'unknown'])(
    'refuses unsupported isolation %s before parent/native contact',
    async (isolation) => {
      fixture.execute.mockResolvedValueOnce([{ transaction_isolation: isolation }])
      await expect(assertWorkspaceArchiveDeletionInTx(tx, reference.workspaceId)).rejects.toThrow(
        'Read Committed'
      )
      expect(fixture.txSelect).not.toHaveBeenCalled()
      expectNoDestructiveContact()
    }
  )

  it('requires the existing admission flag without treating it as a producer join', async () => {
    vi.stubEnv('WORKFLOW_ADMISSIONS_CLOSED', 'false')
    await expect(assertWorkspaceArchiveDeletionInTx(tx, reference.workspaceId)).rejects.toThrow(
      'Close workflow admissions'
    )
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.txSelect).not.toHaveBeenCalled()
    expectNoDestructiveContact()
  })

  it('refuses a missing parent rather than claiming empty-scope deletion is authorized', async () => {
    fixture.txSelect.mockReturnValueOnce(query([], 'workspace'))
    await expect(assertWorkspaceArchiveDeletionInTx(tx, reference.workspaceId)).rejects.toThrow(
      'owner is unavailable'
    )
    expect(fixture.txSelect).toHaveBeenCalledOnce()
    expectNoDestructiveContact()
  })
})

describe('historical preservation actual future-reader boundary ordering', () => {
  function historical(existing = false) {
    const row = {
      ...log(),
      workflowId: 'workflow-a',
      stateSnapshotId: 'snapshot-a',
      cost: null,
      level: 'info',
      startedAt: new Date(0),
      totalDurationMs: 1,
      executionData: {
        environment: { userId: 'original-actor' },
        traceSpans: [{ id: 'legacy-block' }],
        finalOutput: { exact: ' preserved🔥\n ' },
      },
    }
    const graph = { id: 'snapshot-a', workspaceId: row.workspaceId, stateData: { blocks: {} } }
    const functional = { blocks: [], output: row.executionData.finalOutput }
    const retained = {
      ...row,
      executionData: {
        environment: row.executionData.environment,
        finalOutput: { purpose: 'workflow-functional-output' },
      },
    }
    const artifact = {
      record: retained,
      snapshot: graph,
      functional,
      nativeThreads: [],
      sourceFingerprint: 'original-fingerprint',
    }
    if (existing)
      Object.assign(row, {
        executionData: {
          environment: row.executionData.environment,
          preservedFunctionalArchive: reference,
          finalOutput: { purpose: 'workflow-functional-output' },
        },
      })
    fixture.select
      .mockReset()
      .mockReturnValueOnce(query([row]))
      .mockReturnValueOnce(query([graph]))
    fixture.txSelect.mockReset().mockReturnValue(query([row], 'historical'))
    fixture.projectHistorical.mockReturnValue(functional)
    fixture.writeArchive.mockImplementation(async () => {
      fixture.events.push('object.write')
      return reference
    })
    fixture.readArchive.mockImplementation(async () => {
      fixture.events.push('object.read')
      return artifact
    })
    fixture.future.mockImplementation(async (_candidate, authorize) => {
      fixture.events.push('future.read')
      await authorize()
      return {
        status: 'completed',
        result: { success: true, output: functional.output },
        failureReason: null,
      }
    })
    return { row, graph, functional }
  }
  it('passes EXACT prospective activation to the future reader before acquiring the activation lock', async () => {
    const { row } = historical()
    const before = structuredClone(row)
    expect(await preserveHistoricalWorkflowPayload(row.id, async () => {})).toEqual(reference)
    const candidate = fixture.future.mock.calls[0][0]
    expect(candidate.executionData).toMatchObject({
      environment: row.executionData.environment,
      preservedFunctionalArchive: reference,
      finalOutput: { purpose: 'workflow-functional-output' },
    })
    expect(candidate.executionData).not.toHaveProperty('traceSpans')
    expect(fixture.writes).toEqual([
      { cost: candidate.cost, executionData: candidate.executionData },
    ])
    expect(row).toEqual(before)
    expect(fixture.events.indexOf('future.read')).toBeLessThan(
      fixture.events.indexOf('historical.lock:update')
    )
    expect(fixture.access).toHaveBeenCalledWith(
      { workspaceId: row.workspaceId, executionId: row.executionId, logId: row.id },
      'original-actor'
    )
  })
  it.each([false, true])(
    'never counts hash-only success when original finance refuses (existing=%s)',
    async (existing) => {
      const { row } = historical(existing)
      const before = structuredClone(row)
      fixture.future.mockRejectedValueOnce(
        new Error('Original workflow financial binding scope is missing or conflicting')
      )
      await expect(preserveHistoricalWorkflowPayload(row.id, async () => {})).rejects.toThrow(
        'Original workflow financial binding'
      )
      expect(fixture.writes).toEqual([])
      expect(row).toEqual(before)
      expect(fixture.native).not.toHaveBeenCalled()
    }
  )
  it.each([false, true])(
    'refuses changed original source after actual future readback (existing=%s)',
    async (existing) => {
      const { row, functional } = historical(existing)
      fixture.future.mockImplementationOnce(async () => {
        Object.assign(row.executionData, { changed: true })
        return { status: 'completed', result: { output: functional.output } }
      })
      await expect(preserveHistoricalWorkflowPayload(row.id, async () => {})).rejects.toThrow(
        /source revision changed/
      )
      expect(fixture.writes).toEqual([])
    }
  )
  it('denies fresh permission revocation at activation after a successful future-reader seam', async () => {
    const { row } = historical()
    fixture.permission.mockResolvedValueOnce({ hasAccess: false })
    await expect(preserveHistoricalWorkflowPayload(row.id, async () => {})).rejects.toThrow(
      /revoked/
    )
    expect(fixture.writes).toEqual([])
  })
})
