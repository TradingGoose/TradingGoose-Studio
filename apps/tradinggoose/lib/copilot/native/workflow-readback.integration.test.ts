/** @vitest-environment node */
/**
 * Actual workflow queue route, local pending authorization, and canonical result readback.
 * Session, workspace/entity DAL, and enqueue
 * are controlled seams. No external Copilot server or provider is involved.
 */

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
  } = {
    conversationWorkspaceId: 'workspace-a',
    workflowWorkspaceId: 'workspace-b',
    canQueue: true,
    allowedWorkspaces: new Set(),
    pendingValue: null,
    pendingRows: [],
    logRows: [],
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
    queries: vi.fn(),
    tables: {
      pending: {
        id: 'pending.id',
        workflowId: 'pending.workflowId',
        executionType: 'pending.executionType',
        userId: 'pending.userId',
        workspaceId: 'pending.workspaceId',
      },
      logs: {
        id: 'logs.id',
        workflowId: 'logs.workflowId',
        executionId: 'logs.executionId',
        workspaceId: 'logs.workspaceId',
        executionData: 'logs.executionData',
      },
    },
  }
})

function matches(row: Record<string, unknown>, condition: unknown): boolean {
  if (Array.isArray(condition)) return condition.every((item) => matches(row, item))
  if (
    !condition ||
    typeof condition !== 'object' ||
    !('field' in condition) ||
    !('value' in condition)
  )
    throw new Error('Unexpected DAL predicate in controlled source test')
  const field = String(condition.field).split('.').at(-1)
  if (!field) throw new Error('Missing DAL field')
  return row[field] === condition.value
}
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => ({
          limit: async () => {
            m.queries(table, condition)
            const rows =
              table === m.tables.pending
                ? m.state.pendingRows
                : table === m.tables.logs
                  ? m.state.logRows
                  : null
            if (!rows) throw new Error('Unexpected table in controlled source test')
            return rows.filter((row) => matches(row, condition)).slice(0, 1)
          },
        }),
      }),
    }),
  },
}))
vi.mock('@tradinggoose/db/schema', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/db/schema')>()),
  pendingExecution: m.tables.pending,
  workflowExecutionLogs: m.tables.logs,
}))
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...conditions: unknown[]) => conditions,
  eq: (field: unknown, value: unknown) => ({ field, value }),
}))
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
vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: m.enqueue,
  isPendingExecutionLimitError: () => false,
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
  resolveCopilotModel: async (model: string) => ({ model, apiKey: 'admin-key' }),
}))
vi.mock('@/lib/copilot/agent/state', () => ({
  assertCopilotRunActive: async () => undefined,
  claimCopilotBrowserEffect: async (run: { runId: string }, callId: string) => {
    const key = JSON.stringify([run.runId, callId])
    if (m.claims.has(key)) throw new NativeTargetError('Already dispatched', 409)
    m.claims.add(key)
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
import { POST as queuePost } from '@/app/api/workflows/[id]/queue/route'
import { NativeTargetError } from './errors'
import { nativeConversationIdentity } from './identity'
import { readbackNativeToolResult } from './readback'
import { authorizeNativeConversationScope, resolveNativePendingTarget } from './target'

const ACTOR = 'actor'
const WORKFLOW = 'workflow-b'
const EXECUTION = 'original-tool-call'
const NATIVE_RUN = 'original-native-run'
function conversation() {
  return { actorUserId: ACTOR, workspaceId: m.state.conversationWorkspaceId }
}
function originalPending(): Pending {
  return {
    target: {
      resourceId: nativeConversationIdentity(conversation()).resourceId,
      threadId: 'original-thread',
      runId: NATIVE_RUN,
      toolCallId: EXECUTION,
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
    executionId: EXECUTION,
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
async function readback(context?: { workspaceId: string }, signal?: AbortSignal) {
  const original = m.state.pendingValue
  if (!original) throw new Error('Missing Pending')
  const scope = await authorizeNativeConversationScope(ACTOR, m.state.conversationWorkspaceId)
  const pending = await resolveNativePendingTarget(scope, original.target, 'result', signal)
  const result = await readbackNativeToolResult(scope, pending, {
    userId: ACTOR,
    ...context,
    signal,
  })
  return ToolResultSchemas.run_workflow.parse(result)
}
function terminal(failed = false, logOnly = false) {
  const queued = m.state.pendingRows[0]
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
    const inserted = !m.state.pendingRows.some((row) => row.id === input.pendingExecutionId)
    if (inserted)
      m.state.pendingRows.push({
        id: input.pendingExecutionId,
        workflowId: input.workflowId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        executionType: input.executionType,
      })
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
      expect(m.enqueue).toHaveBeenCalledOnce()
      expect(m.forbiddenEffect).not.toHaveBeenCalled()
    }
  )
  it.each([false, true])('preserves failed output after queue-row cleanup=%s', async (logOnly) => {
    expect((await queue()).status).toBe(202)
    terminal(true, logOnly)
    expect(await readback()).toMatchObject({
      data: { success: false, error: 'Original workflow failed after known work' },
    })
    expect(m.enqueue).toHaveBeenCalledOnce()
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
    expect(await readback()).toHaveProperty('executionId', EXECUTION)
    expect(m.workspace).toHaveBeenCalledWith('workspace-b', ACTOR)
    expect(m.workspace).toHaveBeenCalledWith('workspace-c', ACTOR)
    m.state.allowedWorkspaces.delete('workspace-b')
    await expect(readback()).rejects.toMatchObject({ status: 403 })
  })
  it('rejects revoked conversation access before reading execution output', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.allowedWorkspaces.delete('workspace-a')
    await expect(readback()).rejects.toMatchObject({ status: 403 })
  })
  it.each(['workspace', 'actor'])(
    'rejects terminal log %s disagreement before payload access',
    async (field) => {
      expect((await queue()).status).toBe(202)
      const row = terminal()
      if (field === 'workspace') row.workspaceId = 'workspace-c'
      else row.executionData.environment.userId = 'other-actor'
      await expect(readback()).rejects.toMatchObject({ status: 403 })
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
  it('rejects nonterminal logs without replaying', async () => {
    expect((await queue()).status).toBe(202)
    const row = terminal()
    row.endedAt = null
    await expect(readback()).rejects.toMatchObject({ status: 409 })
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
})
