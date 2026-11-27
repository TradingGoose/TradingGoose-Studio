/** @vitest-environment node */
/**
 * Actual workflow queue route, local pending authorization, and canonical result readback.
 * Session, workspace/entity DAL, and enqueue
 * are controlled seams. No external Copilot server or provider is involved.
 */

import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerPending as Pending } from './target'

const m = vi.hoisted(() => {
  const state: {
    conversationWorkspaceId: string | null
    workflowWorkspaceId: string
    canQueue: boolean
    allowedWorkspaces: Set<string>
    pendingValue: Pending | null
    pendingRows: Array<Record<string, unknown>>
    logRows: Array<Record<string, unknown>>
    enqueueFailure: 'backlog' | 'insert' | 'dispatch' | null
  } = {
    conversationWorkspaceId: 'workspace-a',
    workflowWorkspaceId: 'workspace-b',
    canQueue: true,
    allowedWorkspaces: new Set(),
    pendingValue: null,
    pendingRows: [],
    logRows: [],
    enqueueFailure: null,
  }
  return {
    state,
    workspace: vi.fn(),
    entity: vi.fn(),
    enqueue: vi.fn(),
    pending: vi.fn(),
    claims: new Set<string>(),
    workflowAccess: vi.fn(),
    forbiddenEffect: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => {
  const dialect = new PgDialect()
  const select = (fields?: { hasOtherWorkflowOwners?: SQL }) => ({
    from: (table: unknown) => ({
      where: (query: SQL) => {
        const statement = dialect.sqlToQuery(query)
        if (table === workflowExecutionLogs && statement.sql.includes("'queuedExecution' @>")) {
          const parent = JSON.parse(String(statement.params[0]))
          return m.state.logRows.flatMap((row) => {
            if (row.endedAt && statement.sql.includes('"ended_at" is null')) return []
            const data = row.executionData as {
              trigger?: { data: { queuedExecution: { parentExecutionId: string; source: string } } }
              environment?: { userId: string }
            }
            const link = data.trigger?.data.queuedExecution
            if (
              link?.source !== parent.source ||
              link?.parentExecutionId !== parent.parentExecutionId
            )
              return []
            return [
              {
                id: row.executionId,
                userId: data.environment?.userId,
                workflowId: row.workflowId ?? (row.workflowSummary as { id: string }).id,
                workspaceId: row.workspaceId,
                endedAt: row.endedAt,
              },
            ]
          })
        }
        return {
          limit: async () => {
            const pending = table === pendingExecution
            if (!pending && table !== workflowExecutionLogs)
              throw new Error('Unexpected table in controlled source test')
            if (pending && statement.sql.includes("->'metadata'->>")) {
              const [type, key, parent, ...scope] = statement.params
              const [user, ownerType, workflow, workspace, original, source, resume] = scope
              if (scope.length) {
                expect(statement.sql).toContain("->'metadata'->>$2 = $3) or ")
                expect(statement.sql).toContain("->>'resumeExecutionId' = $10")
              }
              return m.state.pendingRows
                .filter((row) => {
                  const payload = row.payload as {
                    metadata?: Record<string, unknown>
                    resumeExecutionId?: string
                  }
                  return (
                    (row.executionType === type && payload.metadata?.[String(key)] === parent) ||
                    (row.userId === user &&
                      row.executionType === ownerType &&
                      row.workflowId === workflow &&
                      row.workspaceId === workspace &&
                      (row.id === original ||
                        (row.source === source && payload.resumeExecutionId === resume)))
                  )
                })
                .slice(0, 1)
            }
            return (pending ? m.state.pendingRows : m.state.logRows)
              .filter((row) => {
                const workflowId = statement.sql.includes('"workflow_summary"')
                  ? (row.workflowSummary as { id: string }).id
                  : row.workflowId
                const identity = pending
                  ? [row.id, workflowId, row.executionType]
                  : [row.executionId, workflowId]
                return JSON.stringify(statement.params) === JSON.stringify(identity)
              })
              .slice(0, 1)
              .map((row) => {
                if (!fields?.hasOtherWorkflowOwners) return row
                const [type, original] = dialect.sqlToQuery(fields.hasOtherWorkflowOwners).params
                return {
                  ...row,
                  hasOtherWorkflowOwners:
                    Boolean(row.endedAt) &&
                    m.state.pendingRows.some(
                      (owner) => owner.executionType === type && owner.id !== original
                    ),
                }
              })
          },
        }
      },
    }),
  })
  return {
    db: {
      select,
      transaction: (run: (tx: { select: typeof select }) => unknown, options: unknown) => {
        expect(options).toEqual({ isolationLevel: 'repeatable read', accessMode: 'read only' })
        return run({ select })
      },
    },
  }
})
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ user: { id: 'actor' } }) }))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: async () => ({ success: true, userId: 'actor', authType: 'session' }),
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.workspace }))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifySavedEntityContext: m.entity,
}))
vi.mock('@/lib/workflows/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/utils')>()),
  readWorkflowAccessContext: m.workflowAccess,
}))
vi.mock('@/lib/execution/pending-execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/pending-execution')>()),
  enqueuePendingExecution: m.enqueue,
}))
vi.mock('@/lib/execution/workflow-execution-stream', () => ({
  openWorkflowExecutionEventStream: () => {
    throw new Error('Unexpected stream/effect in readback source test')
  },
}))
vi.mock('@/lib/copilot/agent/service', () => ({ listCopilotPending: m.pending }))
vi.mock('@/lib/copilot/agent/context', () => ({
  readCopilotRun: async (scope: unknown, threadId: string, runId: string) => ({
    scope,
    threadId,
    runId,
    model: 'openai/admin-model',
  }),
}))
vi.mock('@/lib/copilot/settings.server', () => ({
  validateCopilotModel: async (model: string) => model,
  resolveCopilotModel: async () => ({
    providerId: 'openai',
    modelId: 'admin-model',
    apiKey: 'admin-key',
  }),
}))
vi.mock('@/lib/copilot/agent/receipts', () => ({
  assertCopilotRunActive: async () => undefined,
  claimCopilotEffect: m.forbiddenEffect,
  claimCopilotWorkflowAdmission: async (
    run: { runId: string },
    callId: string,
    transaction: Set<string>
  ) => {
    const key = JSON.stringify([run.runId, callId, 'browser'])
    if (transaction.has(key)) throw new NativeTargetError('Already dispatched', 409)
    transaction.add(key)
  },
}))
vi.mock('@/lib/redis', () => ({ getRedisClient: () => null, getRedisStorageMode: () => 'local' }))
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: m.forbiddenEffect }))
vi.mock('@/lib/copilot/tools/server/workflow/check-deployment-status', () => ({
  checkDeploymentStatusServerTool: { execute: m.forbiddenEffect },
}))
vi.mock('@/lib/credentials/oauth', () => ({
  resolveOAuthCredentialAccountForUser: m.forbiddenEffect,
}))
vi.mock('@/app/api/monitors/shared', () => ({ getMonitorRowById: m.forbiddenEffect }))
vi.mock('@/lib/trigger/settings', () => ({
  TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
    statusCode = 409
  },
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
  },
  getEnv: () => undefined,
  isTruthy: (value: string | undefined) => value === 'true' || value === '1',
}))
vi.unmock('@/blocks/registry')

import { ToolResultSchemas } from '@/lib/copilot/registry'
import { PendingExecutionLimitError } from '@/lib/execution/pending-execution'
import {
  createWorkflowExecutionEventWriter,
  readWorkflowExecutionEventState,
} from '@/lib/execution/workflow-execution-events'
import { POST as queuePost } from '@/app/api/workflows/[id]/queue/route'
import { authorizeNativeBusinessResult } from './business-access'
import { NativeTargetError } from './errors'
import { nativeConversationIdentity, nativeToolCallId } from './identity'
import { readbackNativeToolResult } from './readback'
import { authorizeNativeConversationScope, resolveNativePendingTarget } from './target'

const ACTOR = 'actor'
const WORKFLOW = 'workflow-b'
const TOOL_CALL = 'functions.run_workflow:0'
const NATIVE_RUN = 'original-native-run'
const EXECUTION = nativeToolCallId({ runId: NATIVE_RUN, toolCallId: TOOL_CALL })
function conversation() {
  return { actorUserId: ACTOR, workspaceId: m.state.conversationWorkspaceId }
}
function originalPending(): Pending {
  return {
    target: {
      resourceId: nativeConversationIdentity(conversation()).resourceId,
      threadId: 'original-thread',
      runId: NATIVE_RUN,
      toolCallId: TOOL_CALL,
      toolName: 'run_workflow',
    },
    originalArgs: {
      entityId: WORKFLOW,
      triggerBlockId: 'trigger',
      workflow_input: { literal: '  <working_memory> business </working_memory>\n' },
    },
    stage: 'result',
  }
}
function queueBody() {
  const pending = m.state.pendingValue
  if (!pending) throw new Error('Source fixture must supply original Pending')
  return {
    native: { workspaceId: m.state.conversationWorkspaceId, target: pending.target },
    executionId: nativeToolCallId(pending.target),
    executionTarget: 'live',
    triggerType: 'manual',
    triggerBlockId: 'trigger',
    input: pending.originalArgs.workflow_input,
    workflowData: {
      blocks: { trigger: { type: 'manual_trigger', subBlocks: {} }, output: { type: 'response' } },
      edges: [{ source: 'trigger', target: 'output' }],
      loops: {},
      parallels: {},
    },
  }
}
async function queue() {
  return queuePost(
    new NextRequest(`https://studio.example.test/api/workflows/${WORKFLOW}/queue`, {
      method: 'POST',
      body: JSON.stringify(queueBody()),
    }),
    { params: Promise.resolve({ id: WORKFLOW }) }
  )
}
async function readback(context?: { workspaceId: string }) {
  const original = m.state.pendingValue
  if (!original) throw new Error('Missing Pending')
  const scope = await authorizeNativeConversationScope(ACTOR, m.state.conversationWorkspaceId)
  const pending = await resolveNativePendingTarget(scope, original.target, 'result')
  const result = await readbackNativeToolResult(scope, pending, {
    userId: ACTOR,
    ...context,
  })
  await authorizeNativeBusinessResult(scope, pending, result, context)
  return ToolResultSchemas.run_workflow.parse(result)
}
function terminal(failed = false, logOnly = false) {
  const queued = m.state.pendingRows.at(-1)
  if (!queued) throw new Error('Queue must run before the terminal source seam')
  const row = {
    id: 'original-log',
    executionId: queued.id,
    workflowId: queued.workflowId,
    workspaceId: queued.workspaceId,
    workflowSummary: { id: WORKFLOW },
    level: failed ? 'error' : 'info',
    startedAt: new Date('2026-11-09T00:00:00.000Z'),
    endedAt: new Date('2026-11-09T00:00:01.000Z') as Date | null,
    totalDurationMs: 1000,
    executionData: {
      environment: {
        userId: queued.userId,
        workspaceId: queued.workspaceId,
        workflowId: queued.workflowId,
        executionId: queued.id,
      },
      finalOutput: {
        literal: '  <working_memory> business </working_memory>\n',
        nested: { cost: 'business' },
      },
      ...(failed ? { errorMessage: 'Original workflow failed after known work' } : {}),
    },
  }
  m.state.logRows.push(row)
  if (logOnly) m.state.pendingRows.length = 0
  return row
}

beforeEach(() => {
  vi.clearAllMocks()
  m.state.conversationWorkspaceId = 'workspace-a'
  m.state.workflowWorkspaceId = 'workspace-b'
  m.state.canQueue = true
  m.state.allowedWorkspaces = new Set(['workspace-a', 'workspace-b', 'workspace-c'])
  m.state.pendingRows.length = 0
  m.state.logRows.length = 0
  m.state.enqueueFailure = null
  m.state.pendingValue = originalPending()
  m.workspace.mockReset().mockImplementation(async (workspaceId, actorUserId) => ({
    exists: true,
    hasAccess: actorUserId === ACTOR && m.state.allowedWorkspaces.has(workspaceId),
    canWrite: m.state.canQueue,
    workspace: null,
  }))
  m.entity.mockReset().mockImplementation(async (context, kind, entityId, accessMode) => {
    if (
      context.userId !== ACTOR ||
      kind !== 'workflow' ||
      entityId !== WORKFLOW ||
      accessMode !== 'read' ||
      (context.workspaceId !== undefined && context.workspaceId !== m.state.workflowWorkspaceId) ||
      !(await m.workspace(m.state.workflowWorkspaceId, ACTOR)).hasAccess
    )
      throw new NativeTargetError('Original workflow/business context access denied', 403)
    return { userId: ACTOR, workspaceId: m.state.workflowWorkspaceId, ownerUserId: null }
  })
  m.workflowAccess.mockReset().mockImplementation(async (workflowId, actorUserId) => {
    if (workflowId !== WORKFLOW || actorUserId !== ACTOR) return null
    return {
      workflow: { id: WORKFLOW, workspaceId: m.state.workflowWorkspaceId, isDeployed: true },
      isOwner: false,
      isWorkspaceOwner: false,
      workspacePermission: m.state.canQueue ? 'write' : 'read',
    }
  })
  m.enqueue.mockReset().mockImplementation(async (input) => {
    const transaction = new Set(m.claims)
    if (m.state.enqueueFailure === 'backlog')
      throw new PendingExecutionLimitError({ pendingCount: 1, maxPendingCount: 1 })
    if (m.state.enqueueFailure === 'insert') throw new Error('Queue insert failed')
    const inserted =
      !m.state.pendingRows.some((row) => row.id === input.pendingExecutionId) &&
      !m.state.logRows.some((row) => row.executionId === input.pendingExecutionId)
    if (inserted) {
      await input.afterInsert?.(transaction)
      m.state.pendingRows.push({
        id: input.pendingExecutionId,
        workflowId: input.workflowId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        executionType: input.executionType,
        source: input.source,
        payload: input.payload,
      })
    }
    m.claims = transaction
    if (m.state.enqueueFailure === 'dispatch') throw new Error('Dispatch failed after commit')
    return {
      pendingExecutionId: input.pendingExecutionId,
      inserted,
    }
  })
  m.claims.clear()
  m.pending
    .mockReset()
    .mockImplementation(async () => (m.state.pendingValue ? [m.state.pendingValue] : []))
  m.forbiddenEffect.mockReset().mockImplementation(() => {
    throw new Error('No business effect/review/deployment/provider redispatch is allowed')
  })
})

describe('local workflow execution and authoritative readback', () => {
  it.each(['original-thread', 'another-thread'])(
    'isolates repeated provider call IDs across runs in %s',
    async (threadId) => {
      const first = originalPending()
      expect((await queue()).status).toBe(202)
      const original = terminal()
      m.state.pendingValue = {
        ...first,
        target: { ...first.target, threadId, runId: 'another-native-run' },
      }
      const nextId = nativeToolCallId(m.state.pendingValue.target)
      expect(nextId).not.toBe(EXECUTION)
      await expect(readback()).rejects.toMatchObject({ status: 409 })
      expect((await queue()).status).toBe(202)
      const next = terminal(true)
      expect(await readback()).toMatchObject({ executionId: nextId, data: { success: false } })
      expect((await queue()).status).toBe(409)
      expect(m.state.pendingRows.map((row) => row.id)).toEqual([EXECUTION, nextId])
      expect(m.claims.size).toBe(2)
      expect(next.executionId).not.toBe(original.executionId)
      m.state.pendingValue = first
      expect(await readback()).toMatchObject({ executionId: EXECUTION, data: { success: true } })
      expect(m.forbiddenEffect).not.toHaveBeenCalled()
    }
  )
  it.each([null, 'workspace-a', 'workspace-b'])(
    'queues once and reads canonical output from conversation %j',
    async (workspaceId) => {
      m.state.conversationWorkspaceId = workspaceId
      m.state.pendingValue = originalPending()
      const original = structuredClone(m.state.pendingValue)
      expect((await queue()).status).toBe(202)
      terminal()
      expect(await readback({ workspaceId: 'workspace-b' })).toMatchObject({
        executionId: EXECUTION,
        data: {
          success: true,
          output: { literal: '  <working_memory> business </working_memory>\n' },
        },
      })
      expect(m.state.pendingValue).toEqual(original)
      expect((await queue()).status).toBe(409)
      expect(m.enqueue).toHaveBeenCalledTimes(2)
      expect(m.state.pendingRows).toHaveLength(1)
      expect(m.claims.size).toBe(1)
      expect(m.forbiddenEffect).not.toHaveBeenCalled()
    }
  )
  it.each(['backlog', 'insert'] as const)(
    'keeps the same native target retryable after %s rejects admission',
    async (failure) => {
      m.state.enqueueFailure = failure
      const response = await queue()
      expect(response.status).toBe(failure === 'backlog' ? 429 : 500)
      if (failure === 'backlog')
        expect(await response.json()).toMatchObject({ code: 'PENDING_EXECUTION_LIMIT' })
      expect(m.claims.size).toBe(0)
      expect(m.state.pendingRows).toEqual([])
      m.state.enqueueFailure = null
      expect((await queue()).status).toBe(202)
      terminal()
      expect(await readback()).toMatchObject({ executionId: EXECUTION, data: { success: true } })
      expect(m.state.pendingRows).toHaveLength(1)
      expect(m.claims.size).toBe(1)
    }
  )
  it('returns a duplicate without claiming a row admitted outside Copilot', async () => {
    m.state.pendingRows.push({ id: EXECUTION })
    const response = await queue()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Workflow execution already exists' })
    expect(m.claims.size).toBe(0)
    expect(m.state.pendingRows).toEqual([{ id: EXECUTION }])
  })
  it('retains the effect claim when dispatch fails after admission commits', async () => {
    m.state.enqueueFailure = 'dispatch'
    expect((await queue()).status).toBe(500)
    expect(m.claims.size).toBe(1)
    m.state.enqueueFailure = null
    expect((await queue()).status).toBe(409)
    expect(m.state.pendingRows).toHaveLength(1)
    terminal()
    expect(await readback()).toMatchObject({ executionId: EXECUTION, data: { success: true } })
  })
  it.each([false, true])('recovers deleted workflow output (failed=%s)', async (failed) => {
    expect((await queue()).status).toBe(202)
    const row = terminal(failed, true)
    row.workflowId = null
    m.entity.mockRejectedValue(new NativeTargetError('Workflow no longer exists', 403))
    expect(await readback()).toMatchObject({
      data: { success: !failed, output: row.executionData.finalOutput },
    })
    expect(m.enqueue).toHaveBeenCalledOnce()
    m.state.allowedWorkspaces.delete('workspace-b')
    await expect(readback()).rejects.toMatchObject({ status: 403 })
  })
  it('permits current read access to a completed run while rejecting another write', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.canQueue = false
    expect(await readback()).toHaveProperty('executionId', EXECUTION)
    expect((await queue()).status).toBe(403)
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it('checks original execution workspace independently from the current workflow workspace', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.workflowWorkspaceId = 'workspace-c'
    m.workspace.mockClear()
    expect(await readback()).toHaveProperty('executionId', EXECUTION)
    expect(m.workspace).toHaveBeenCalledWith('workspace-b', ACTOR)
    expect(m.workspace).not.toHaveBeenCalledWith('workspace-c', ACTOR)
    m.state.allowedWorkspaces.delete('workspace-b')
    await expect(readback()).rejects.toMatchObject({ status: 403 })
  })
  it('rejects revoked conversation access before reading execution output', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.allowedWorkspaces.delete('workspace-a')
    await expect(readback()).rejects.toMatchObject({ status: 403 })
  })
  it.each(['workspace', 'actor', 'workflow', 'execution'])(
    'rejects terminal log %s disagreement before payload access',
    async (field) => {
      expect((await queue()).status).toBe(202)
      const row = terminal()
      if (field === 'workspace') row.workspaceId = 'workspace-c'
      if (field === 'actor') row.executionData.environment.userId = 'other-actor'
      if (field === 'workflow') row.workflowSummary.id = 'foreign-workflow'
      if (field === 'execution') row.executionId = 'foreign-execution'
      await expect(readback()).rejects.toMatchObject({
        status: field === 'workspace' || field === 'actor' ? 403 : 409,
      })
    }
  )
  it('rejects a foreign actor after queue-row cleanup', async () => {
    expect((await queue()).status).toBe(202)
    const row = terminal(false, true)
    row.executionData.environment.userId = 'other-actor'
    await expect(readback()).rejects.toMatchObject({ status: 403 })
  })
  it('rejects conflicting business workspace context', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    await expect(readback({ workspaceId: 'workspace-c' })).rejects.toMatchObject({ status: 403 })
  })
  it('attests each pause revision and follows the original admitted ID across a running checkpoint', async () => {
    expect((await queue()).status).toBe(202)
    const row = terminal()
    row.endedAt = null
    const pause = { url: 'https://studio.example/resume/review', revision: 1 }
    const data: Record<string, unknown> = row.executionData
    data.pause = pause
    await expect(readback()).resolves.toMatchObject({
      message: 'Workflow paused for review',
      data: { status: 'paused', output: pause },
    })
    data.checkpoint = { revision: 1, activeJobId: `${EXECUTION}:resume:1` }
    const observation = { pendingExecutionId: EXECUTION, workflowId: WORKFLOW, afterEventId: 0 }
    await createWorkflowExecutionEventWriter(observation).write({
      type: 'execution:paused',
      data: { result: { success: true, status: 'paused', output: pause } },
    })
    await expect(readback()).rejects.toMatchObject({ handle: { taskId: EXECUTION } })
    await expect(readWorkflowExecutionEventState(observation)).resolves.toMatchObject({
      status: 'processing',
      result: null,
      events: [],
    })
    data.pause = undefined
    await expect(readback()).rejects.toMatchObject({
      handle: {
        executionId: EXECUTION,
        taskId: EXECUTION,
        workflowId: WORKFLOW,
      },
    })
    m.state.allowedWorkspaces.delete(row.workspaceId as string)
    await expect(readback()).rejects.toMatchObject({ status: 403 })
    m.state.allowedWorkspaces.add(row.workspaceId as string)
    data.pause = { ...pause, revision: 2 }
    data.checkpoint = { revision: 2, activeJobId: null }
    await expect(readback()).resolves.toMatchObject({
      data: { status: 'paused', output: { revision: 2 } },
    })
    data.pause = undefined
    row.endedAt = new Date()
    row.level = 'error'
    data.errorMessage = 'Workflow execution was cancelled'
    await expect(readback()).resolves.toMatchObject({
      message: data.errorMessage,
      data: { success: false, error: data.errorMessage },
    })
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it.each([
    ['queued child before its log exists', 0, 'workflow_block'],
    ['original child owner', 1, 'workflow_block'],
    ['resumed child', 1, 'human_in_the_loop'],
    ['resumed grandchild through a finished child', 2, 'human_in_the_loop'],
  ] as const)(
    'keeps the original observation until the %s retires',
    async (_label, depth, source) => {
      expect((await queue()).status).toBe(202)
      const row = terminal(false, true)
      let parent = EXECUTION
      for (const child of ['child', 'grandchild'].slice(0, depth)) {
        m.state.logRows.push({
          ...row,
          executionId: child,
          workflowId: 'child-workflow',
          workflowSummary: { id: 'child-workflow' },
          executionData: {
            environment: { userId: ACTOR },
            trigger: {
              data: { queuedExecution: { source: 'workflow_block', parentExecutionId: parent } },
            },
          },
        })
        parent = child
      }
      const owner = {
        id: source === 'human_in_the_loop' ? `${parent}:resume:1` : 'child',
        executionType: 'workflow',
        source,
        userId: ACTOR,
        workspaceId: row.workspaceId,
        workflowId: 'child-workflow',
        status: 'processing',
        payload: {
          ...(depth === 0 && { metadata: { parentExecutionId: EXECUTION } }),
          ...(source === 'human_in_the_loop' && {
            resumeExecutionId: parent,
            checkpointRevision: 1,
          }),
        },
      }
      m.state.pendingRows.push(owner)
      for (const [key, value] of Object.entries({
        userId: 'other-actor',
        workspaceId: 'other-workspace',
        workflowId: 'other-workflow',
        source: 'manual',
        executionType: 'document',
        payload: { resumeExecutionId: 'other-child' },
      })) {
        m.state.pendingRows.push({
          ...owner,
          id: `other-${key}`,
          source: 'human_in_the_loop',
          payload: { resumeExecutionId: parent },
          [key]: value,
        })
      }
      const observation = { pendingExecutionId: EXECUTION, workflowId: WORKFLOW, afterEventId: 0 }
      await createWorkflowExecutionEventWriter(observation).write({
        type: 'execution:completed',
        data: { result: { success: true, output: row.executionData.finalOutput } },
      })
      await expect(readback()).rejects.toMatchObject({
        handle: { workflowId: WORKFLOW, taskId: EXECUTION, executionId: EXECUTION },
      })
      await expect(readWorkflowExecutionEventState(observation)).resolves.toMatchObject({
        status: 'processing',
        result: null,
        events: [],
      })
      expect(m.state.pendingRows.shift()).toBe(owner)
      await expect(readback()).resolves.toMatchObject({
        data: { output: row.executionData.finalOutput },
      })
      await expect(readWorkflowExecutionEventState(observation)).resolves.toMatchObject({
        status: 'completed',
        result: { output: row.executionData.finalOutput },
      })
      expect(m.enqueue).toHaveBeenCalledOnce()
    }
  )
  it('rejects nonterminal logs without replaying', async () => {
    expect((await queue()).status).toBe(202)
    const row = terminal()
    row.endedAt = null
    await expect(readback()).rejects.toMatchObject({ status: 409 })
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
})
