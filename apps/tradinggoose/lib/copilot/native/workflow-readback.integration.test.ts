/** @vitest-environment node */
/**
 * Actual queue/native-target/readback/canonical-result/signed-proof composition.
 * Native transport, session, workspace/entity DAL, enqueue, archive bytes and financial
 * verification are controlled source seams. No actual executor, receipt DB or provider.
 */

import type { FinancialBinding } from '@tradinggoose/billing'
import { decodeJwt } from 'jose'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalLogFixture,
  hydrateCanonicalLogFixture,
} from '@/lib/execution/__test-utils__/canonical-log-fixture'
import type { CopilotRequest, Pending } from './contract'

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
    nativeRead: vi.fn(),
    verify: vi.fn(),
    hydrate: vi.fn(),
    duringHydration: vi.fn(),
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
vi.mock('@/lib/copilot/native/client', () => ({ readNativeCopilot: m.nativeRead }))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: m.verify }))
vi.mock('@/lib/workflow-archive/functional', () => ({
  hydrateExecutionPayload: (...args: unknown[]) => m.hydrate(...args),
  assertRetainedLogAccess: () => {
    throw new Error('Canonical readback must supply its repeated authorization callback')
  },
}))
vi.mock('@/lib/redis', () => ({ getRedisClient: () => null, getRedisStorageMode: () => 'local' }))
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: m.forbiddenEffect }))
vi.mock('@/lib/copilot/tools/server/review-acceptance', () => ({
  acceptServerManagedToolReview: m.forbiddenEffect,
  stageServerManagedToolReview: m.forbiddenEffect,
}))
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
    INTERNAL_API_SECRET: 'r7-controlled-source-proof-only-not-a-live-secret',
    NODE_ENV: 'test',
  },
  getEnv: () => undefined,
  isTruthy: (value: string | undefined) => value === 'true' || value === '1',
}))
vi.unmock('@/blocks/registry')

import { verifyCopilotToolResultProof } from '@/lib/copilot/result-proof'
import { POST as readbackPost } from '@/app/api/copilot/execute-copilot-server-tool/route'
import { POST as queuePost } from '@/app/api/workflows/[id]/queue/route'
import { COPILOT_NATIVE_REVISION, parseNativeContract } from './contract'
import { nativeConversationIdentity, nativeFinancialRootId, nativeResultBinding } from './identity'
import { NativeTargetError } from './target'

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
    financialBinding: {
      namespace: 'billing-usage:copilot-source-fixture',
      key: `invocation:${NATIVE_RUN}`,
      fingerprint: 'original-copilot-fingerprint',
      actorUserId: ACTOR,
      workspaceId: m.state.conversationWorkspaceId,
      workflowId: null,
      runId: NATIVE_RUN,
      purpose: 'copilot',
    },
    financialOccurrence: { runId: NATIVE_RUN, stepNumber: 3, retryCount: 0 },
  }
}
function originalWorkflowBinding(): FinancialBinding {
  return {
    namespace: 'billing-usage:workflow-source-fixture',
    key: `invocation:${EXECUTION}`,
    fingerprint: 'original-workflow-fingerprint',
    actorUserId: ACTOR,
    workspaceId: 'workspace-b',
    workflowId: WORKFLOW,
    runId: EXECUTION,
    purpose: 'workflow-execution',
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
  const pending = m.state.pendingValue
  if (!pending) throw new Error('Missing source Pending')
  return readbackPost(
    new NextRequest('https://studio.example.test/api/copilot/execute-copilot-server-tool', {
      method: 'POST',
      body: JSON.stringify({
        action: 'readback',
        native: { workspaceId: m.state.conversationWorkspaceId, target: pending.target },
        ...(context ? { context } : {}),
      }),
      ...(signal ? { signal } : {}),
    })
  )
}
function terminal(failed = false, logOnly = false) {
  const queued = m.state.pendingRows[0]
  if (!queued) throw new Error('Queue must run before the terminal source seam')
  const row = canonicalLogFixture({
    id: 'original-log',
    executionId: queued.id,
    workflowId: queued.workflowId,
    workspaceId: queued.workspaceId,
    workflowSummary: { id: WORKFLOW },
    level: failed ? 'error' : 'info',
    startedAt: new Date('2026-11-09T00:00:00.000Z'),
    endedAt: new Date('2026-11-09T00:00:01.000Z'),
    totalDurationMs: 1000,
    executionData: {
      environment: {
        userId: queued.userId,
        workspaceId: queued.workspaceId,
        workflowId: queued.workflowId,
        executionId: queued.id,
      },
      billing: { binding: originalWorkflowBinding() },
      finalOutput: {
        literal: '  <working_memory> business </working_memory>\n',
        nested: { cost: 'business' },
      },
      ...(failed ? { errorMessage: 'Original workflow failed after known work' } : {}),
    },
  })
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
      billingScopeId: 'source-fixture',
      inserted,
    }
  })
  m.nativeRead.mockReset().mockImplementation(async (request: CopilotRequest) => {
    if (request.command !== 'pending.list')
      throw new Error('No inference/resume allowed in source test')
    return {
      status: 200,
      result: await parseNativeContract('CopilotResponse', {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: request.requestId,
        status: 'pending_targets',
        items: m.state.pendingValue ? [m.state.pendingValue] : [],
        page: request.page,
        hasMore: false,
      }),
    }
  })
  // Explicit verification seam: these values are not actual receipts/monetary evidence.
  m.verify
    .mockReset()
    .mockResolvedValue({ accepted: true, appliedUsd: '0.001234', modelUsd: 'unavailable' })
  m.duringHydration.mockReset().mockResolvedValue(undefined)
  m.hydrate.mockReset().mockImplementation(async (row, authorize) => {
    await authorize()
    await m.duringHydration()
    return hydrateCanonicalLogFixture(row, authorize)
  })
  m.forbiddenEffect.mockReset().mockImplementation(() => {
    throw new Error('No business effect/review/deployment/provider redispatch is allowed')
  })
})

describe('original workflow B outcome from conversation A through actual routes', () => {
  it.each([null, 'workspace-a', 'workspace-b'])(
    'queues once and signs canonical readback for unchanged conversation %j with separate finance',
    async (workspaceId) => {
      m.state.conversationWorkspaceId = workspaceId
      m.state.pendingValue = originalPending()
      const original = structuredClone(m.state.pendingValue)
      expect((await queue()).status).toBe(202)
      expect(m.enqueue).toHaveBeenCalledOnce()
      expect(m.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingExecutionId: EXECUTION,
          workflowId: WORKFLOW,
          userId: ACTOR,
          workspaceId: 'workspace-b',
        })
      )
      terminal()
      const response = await readback({ workspaceId: 'workspace-b' })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.result).toMatchObject({
        executionId: EXECUTION,
        data: {
          success: true,
          output: { literal: '  <working_memory> business </working_memory>\n' },
        },
      })
      await expect(
        verifyCopilotToolResultProof(body.proof, {
          binding: nativeResultBinding(conversation(), original),
          originalArgs: original.originalArgs,
          result: body.result,
        })
      ).resolves.toBeUndefined()
      expect(decodeJwt(body.proof)).toMatchObject({
        workspaceId,
        actorId: ACTOR,
        runId: NATIVE_RUN,
        toolCallId: EXECUTION,
        financialRootId: nativeFinancialRootId(original.financialBinding),
      })
      expect(m.verify).toHaveBeenCalledWith(original.financialBinding, original.financialOccurrence)
      expect(m.verify).toHaveBeenCalledWith(originalWorkflowBinding(), {
        stepNumber: 0,
        retryCount: 0,
        runId: EXECUTION,
      })
      expect(original.financialBinding.workspaceId).toBe(workspaceId)
      expect(m.state.pendingValue).toEqual(original)
      expect(m.enqueue).toHaveBeenCalledOnce()
      expect(m.forbiddenEffect).not.toHaveBeenCalled()
    }
  )
  it.each([false, true])(
    'preserves original failed workflow output, pending-row fallback=%s',
    async (logOnly) => {
      expect((await queue()).status).toBe(202)
      terminal(true, logOnly)
      const response = await readback()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.result.data).toMatchObject({
        success: false,
        error: 'Original workflow failed after known work',
      })
      expect(body.proof).toEqual(expect.any(String))
      expect(m.enqueue).toHaveBeenCalledOnce()
    }
  )
  it('allows read-only original B after queue, but cannot queue another execution', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.canQueue = false
    expect((await readback()).status).toBe(200)
    expect((await queue()).status).toBe(403)
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it('retains historical execution B when current workflow authorization resolves C', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.workflowWorkspaceId = 'workspace-c'
    expect((await readback()).status).toBe(200)
    expect(m.workspace).toHaveBeenCalledWith('workspace-b', ACTOR)
    expect(m.workspace).toHaveBeenCalledWith('workspace-c', ACTOR)
  })
  it('independently refuses revoked original B although current workflow C remains authorized', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.workflowWorkspaceId = 'workspace-c'
    m.state.allowedWorkspaces.delete('workspace-b')
    expect((await readback()).status).toBe(403)
    expect(m.hydrate).not.toHaveBeenCalled()
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it('refuses conversation A revocation before reading workflow output', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.allowedWorkspaces.delete('workspace-a')
    expect((await readback()).status).toBe(403)
    expect(m.hydrate).not.toHaveBeenCalled()
  })
  it('rechecks B through canonical hydration and returns no proof after mid-read revocation', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.state.workflowWorkspaceId = 'workspace-c'
    m.duringHydration.mockImplementationOnce(() => {
      m.state.allowedWorkspaces.delete('workspace-b')
    })
    const response = await readback()
    expect(response.status).toBe(403)
    expect((await response.json()).proof).toBeUndefined()
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it.each(['workspace', 'actor'])(
    'refuses pending/log %s disagreement before canonical payload',
    async (field) => {
      expect((await queue()).status).toBe(202)
      const row = terminal()
      if (field === 'workspace') row.workspaceId = 'workspace-c'
      else row.executionData.environment.userId = 'other-actor'
      const response = await readback()
      expect(response.status).toBe(403)
      expect((await response.json()).proof).toBeUndefined()
      expect(m.hydrate).not.toHaveBeenCalled()
    }
  )
  it('log-only fallback rejects another actor without exposing canonical payload', async () => {
    expect((await queue()).status).toBe(202)
    const row = terminal(false, true)
    row.executionData.environment.userId = 'other-actor'
    expect((await readback()).status).toBe(403)
    expect(m.hydrate).not.toHaveBeenCalled()
  })
  it('keeps supplied business workspace conflict refusal, never replaces it with A or B', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    expect((await readback({ workspaceId: 'workspace-c' })).status).toBe(403)
    expect(m.hydrate).not.toHaveBeenCalled()
  })
  it('refuses missing original workflow acceptance despite accepted Copilot occurrence', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.verify.mockImplementation(async (binding: FinancialBinding) => {
      if (binding.purpose === 'workflow-execution')
        throw new Error('Original workflow receipt unavailable')
      return { accepted: true, appliedUsd: '0.001234', modelUsd: 'unavailable' }
    })
    const response = await readback()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect((await response.json()).proof).toBeUndefined()
    expect(m.hydrate).not.toHaveBeenCalled()
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it('refuses nonterminal and missing canonical payload without manufacturing success', async () => {
    expect((await queue()).status).toBe(202)
    const row = terminal()
    row.endedAt = null
    expect((await readback()).status).toBe(409)
    row.endedAt = new Date('2026-11-09T00:00:01.000Z')
    m.hydrate.mockRejectedValueOnce(new Error('Canonical payload digest mismatch'))
    const response = await readback()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect((await response.json()).proof).toBeUndefined()
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it('rejects altered original Copilot finance without substituting the workflow receipt', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    const pending = m.state.pendingValue
    if (!pending) throw new Error('Missing original Pending')
    pending.financialBinding.workspaceId = 'workspace-b'
    expect((await readback()).status).toBe(403)
    expect(m.hydrate).not.toHaveBeenCalled()
    expect(m.enqueue).toHaveBeenCalledOnce()
  })
  it('final whole-Pending change after canonical hydration refuses signed completion without replay', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    m.duringHydration.mockImplementationOnce(() => {
      const pending = m.state.pendingValue
      if (!pending) throw new Error('Missing original Pending')
      m.state.pendingValue = {
        ...pending,
        financialOccurrence: { ...pending.financialOccurrence, stepNumber: 4 },
      }
    })
    const response = await readback()
    expect(response.status).toBe(409)
    expect((await response.json()).proof).toBeUndefined()
    expect(m.hydrate).toHaveBeenCalledOnce()
    expect(m.enqueue).toHaveBeenCalledOnce()
    expect(m.forbiddenEffect).not.toHaveBeenCalled()
  })
  it('cancellation during hydration cannot publish proof or replay effects', async () => {
    expect((await queue()).status).toBe(202)
    terminal()
    const controller = new AbortController()
    m.duringHydration.mockImplementationOnce(() => {
      controller.abort()
    })
    const response = await readback(undefined, controller.signal)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect((await response.json()).proof).toBeUndefined()
    expect(m.enqueue).toHaveBeenCalledOnce()
    expect(m.forbiddenEffect).not.toHaveBeenCalled()
  })
})
