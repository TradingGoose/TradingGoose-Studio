/** @vitest-environment node */
import { db } from '@tradinggoose/db'
import {
  organizationBillingLedger,
  userStats,
  user as userTable,
  workflowExecutionLogs,
} from '@tradinggoose/db/schema'
import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginWorkflowModelUsage,
  type ModelUsageScope,
  recordModelUsage,
} from '@/lib/billing/model-usage'
import { getInferenceFacts, type InferenceFacts } from '@/lib/mastra/result'
import type { NativeUsage } from '@/lib/mastra/usage'
import { createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { executeTool } from '@/tools'
import { ExecutionLogger } from './logger'

const state = vi.hoisted(() => ({
  log: {} as Record<string, any>,
  ledgers: {} as Record<string, Record<string, any> | null>,
  context: {} as Record<string, any>,
  lock: Promise.resolve() as Promise<unknown>,
  locked: false,
  locks: [] as unknown[],
  failLedger: false,
  failWatermark: false,
  settings: vi.fn(),
  contextLookup: vi.fn(),
  modelMultiplier: vi.fn(),
  baseMultiplier: vi.fn(),
  threshold: vi.fn(),
  email: vi.fn(),
  emit: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => {
  const ledgerKey = (table: unknown) =>
    table === userStats ? 'user' : table === organizationBillingLedger ? 'organization' : 'member'
  const rows = (table: unknown) =>
    table === workflowExecutionLogs
      ? [state.log]
      : table === userTable
        ? [{ email: 'billing@example.com', name: 'Owner' }]
        : state.ledgers[ledgerKey(table)]
          ? [state.ledgers[ledgerKey(table)]]
          : []
  const dialect = () => new PgDialect()
  const query = (table?: unknown, update?: Record<string, any>) => {
    let predicate: SQL | undefined
    let applied = false
    let value: any[]
    const run = () => {
      if (applied) return value
      applied = true
      const filter = predicate && dialect().sqlToQuery(predicate)
      if (table === workflowExecutionLogs && filter) {
        for (const [column, actual] of [
          ['workflow_id', state.log.workflowId],
          ['workspace_id', state.log.workspaceId],
          ['execution_id', state.log.executionId],
        ]) {
          const match = filter.sql.match(new RegExp(`"${column}" = \\$(\\d+)`))
          if (match && filter.params[Number(match[1]) - 1] !== actual) return (value = [])
        }
        if (
          filter.sql.includes("->'environment'->>'userId'") &&
          filter.params.at(-1) !== state.log.executionData.environment.userId
        )
          return (value = [])
      }
      if (
        table === workflowExecutionLogs &&
        filter?.sql.includes('"ended_at" is null') &&
        state.log.endedAt
      ) {
        return (value = [])
      }
      value = rows(table)
      if (!update) return value
      if (table !== workflowExecutionLogs && state.failLedger) throw new Error('ledger unavailable')
      if (
        table === workflowExecutionLogs &&
        !(update.executionData instanceof SQL) &&
        state.failWatermark
      ) {
        throw new Error('watermark unavailable')
      }
      for (const row of value) {
        for (const [key, entry] of Object.entries(update)) {
          if (!(entry instanceof SQL)) {
            row[key] = structuredClone(entry)
            continue
          }
          const compiled = dialect().sqlToQuery(entry)
          if (key === 'executionData') {
            const patch = JSON.parse(compiled.params[0] as string)
            const billable = JSON.parse(compiled.params[1] as string)
            const {
              checkpoint: _checkpoint,
              pause: _pause,
              ...data
            } = {
              ...row.executionData,
              ...patch,
              billing: { ...row.executionData.billing, ...billable },
            }
            row.executionData = data
          } else {
            row[key] = Number(row[key] ?? 0) + Number(compiled.params[0] ?? 1)
          }
        }
      }
      return value
    }
    const chain = {
      from: (target: unknown) => {
        table = target
        return chain
      },
      where: (condition: SQL) => {
        predicate = condition
        return chain
      },
      limit: () => chain,
      for: () => {
        expect(state.locked).toBe(true)
        state.locks.push(table)
        return chain
      },
      returning: () => chain,
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    }
    return chain
  }
  const connection = {
    select: () => query(),
    update: (table: unknown) => ({ set: (update: Record<string, any>) => query(table, update) }),
  }
  return {
    db: {
      ...connection,
      transaction: async (callback: (tx: typeof connection) => Promise<unknown>) => {
        const previous = state.lock
        let release = () => {}
        state.lock = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        const log = structuredClone(state.log)
        const ledgers = structuredClone(state.ledgers)
        state.locked = true
        try {
          return await callback(connection)
        } catch (error) {
          state.log = log
          state.ledgers = ledgers
          throw error
        } finally {
          state.locked = false
          release()
        }
      },
    },
  }
})

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: state.settings,
  isBillingEnabledForRuntime: async () => (await state.settings()).billingEnabled,
}))
vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: state.contextLookup,
  resolveWorkflowBillingContext: state.contextLookup,
}))
vi.mock('@/lib/billing/tiers', () => ({
  getTierWorkflowExecutionMultiplier: state.baseMultiplier,
  getTierWorkflowModelCostMultiplier: state.modelMultiplier,
  getTierDisplayName: () => 'Plan',
  getTierUsageAllowanceUsd: () => 100,
  isFreeBillingTier: () => false,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  getBillingTierPricing: () => ({ usageAllowance: 100 }),
}))
vi.mock('@/lib/billing/core/usage', () => ({
  getUserUsageLimit: async () => 100,
  maybeSendUsageThresholdEmail: state.email,
}))
vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: state.threshold,
}))
vi.mock('@/lib/logs/events', () => ({ emitWorkflowExecutionCompleted: state.emit }))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({ snapshotService: {} }))
vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: async () => 'internal-fixture' }))

const span = (cost = 2, tokens = 150) => ({
  id: 'agent',
  name: 'Agent',
  type: 'agent',
  status: 'success' as const,
  startTime: '2026-09-17T12:00:00Z',
  endTime: '2026-09-17T12:00:01Z',
  duration: 1000,
  inference: {
    model: 'model',
    cost: { input: cost * 0.75, output: cost * 0.25, total: cost, status: 'reported' as const },
    tokens: { prompt: (tokens * 2) / 3, completion: tokens / 3, total: tokens },
    generatedFields: [],
  },
  model: 'model',
  cost: { input: cost * 0.75, output: cost * 0.25, total: cost },
  tokens: { prompt: (tokens * 2) / 3, completion: tokens / 3, total: tokens },
})
const completion = {
  executionId: 'execution',
  workflowLogId: 'log',
  workspaceId: 'workspace',
  endedAt: '2026-09-17T12:00:01Z',
  totalDurationMs: 1000,
  finalOutput: { done: true },
  success: true,
  traceSpans: [span()],
}
let logger: ExecutionLogger

const usageScope: ModelUsageScope = {
  actorUserId: 'actor',
  workspaceId: 'workspace',
  workflowId: 'workflow',
  executionId: 'execution',
  funding: 'account',
  purpose: 'workflow-agent',
  runId: 'native-run',
  model: 'model',
}
async function observe(id: string, facts: InferenceFacts = span().inference) {
  const scope = {
    ...usageScope,
    model: facts.model ?? 'model',
    funding: facts.cost?.accountCost === null ? ('byok' as const) : ('account' as const),
  }
  expect(await beginWorkflowModelUsage(scope, id)).toBe(true)
  const usage: NativeUsage = {
    inputTokens: facts.tokens?.prompt,
    outputTokens: facts.tokens?.completion,
    totalTokens: facts.tokens?.total,
  }
  return recordModelUsage(scope, usage, facts.cost!, id)
}
async function replaceObservations(...facts: InferenceFacts[]) {
  state.log.executionData.billing = { nativeUsage: {} }
  for (const [index, fact] of facts.entries()) await observe(`native-${index}`, fact)
}

beforeEach(async () => {
  vi.clearAllMocks()
  state.lock = Promise.resolve()
  state.locked = false
  state.locks = []
  state.failLedger = false
  state.failWatermark = false
  state.settings.mockResolvedValue({ billingEnabled: true, workflowExecutionChargeUsd: 0.25 })
  state.baseMultiplier.mockReturnValue(1)
  state.modelMultiplier.mockReturnValue(1)
  state.context = {
    workspaceId: 'workspace',
    actorUserId: 'actor',
    billingUserId: 'owner',
    billingOwner: { type: 'user', userId: 'owner' },
    scopeType: 'user',
    scopeId: 'owner',
    subscription: null,
    tier: {},
  }
  state.contextLookup.mockImplementation(async () => state.context)
  state.threshold.mockImplementation(async () => {
    expect(state.locked).toBe(false)
  })
  state.email.mockImplementation(async () => {
    expect(state.locked).toBe(false)
  })
  state.emit.mockResolvedValue(undefined)
  state.ledgers = Object.fromEntries(
    ['user', 'organization', 'member'].map((key) => [
      key,
      {
        totalCost: 0,
        currentPeriodCost: 0,
        totalTokensUsed: 0,
        totalApiCalls: 0,
      },
    ])
  )
  state.log = {
    id: 'log',
    executionId: 'execution',
    workflowId: 'workflow',
    workspaceId: 'workspace',
    stateSnapshotId: 'snapshot',
    workflowSummary: { id: 'workflow' },
    level: 'info',
    trigger: 'api',
    startedAt: new Date('2026-09-17T12:00:00Z'),
    createdAt: new Date('2026-09-17T12:00:00Z'),
    endedAt: null,
    totalDurationMs: null,
    executionData: {
      environment: { userId: 'actor', variables: { old: 'value' } },
      checkpoint: { revision: 1 },
      traceSpans: [span()],
      untouched: 'preserve',
    },
  }
  logger = new ExecutionLogger()
  await observe('native-initial')
})
afterEach(() => vi.unstubAllGlobals())

describe('durable native observations', () => {
  it.each(
    (['account', 'byok'] as const).flatMap((funding) =>
      [false, true].map((unpriced) => ({ funding, unpriced }))
    )
  )(
    'settles completed retrieval after pre-response cancellation ($funding, unpriced=$unpriced)',
    async ({ funding, unpriced }) => {
      const cancelled = new AbortController()
      const retrieval = { ...usageScope, purpose: 'embedding', model: 'native/embedding', funding }
      const scoring = { ...usageScope, model: 'native/scoring' }
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init: RequestInit) => {
          const disconnected = new Promise<never>((_resolve, reject) => {
            init.signal!.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            )
          })
          await beginWorkflowModelUsage(retrieval, 'retrieval')
          await recordModelUsage(
            retrieval,
            { inputTokens: 100, totalTokens: 100 },
            unpriced ? { status: 'unavailable' } : { total: 0.01, status: 'estimated' },
            'retrieval'
          )
          await beginWorkflowModelUsage(scoring, 'scoring')
          expect(state.ledgers.user?.totalCost).toBe(0)
          cancelled.abort()
          return disconnected
        })
      )
      const result = await executeTool(
        'guardrails_validate',
        {
          input: 'Check this',
          validationType: 'hallucination',
          model: 'native/scoring',
          knowledgeBaseId: 'kb',
          _context: { toolExecutionId: 'agent' },
        },
        false,
        {
          ...createMockContext({ workflowId: 'workflow', workspaceId: 'workspace' }),
          userId: 'actor',
          executionId: 'execution',
          workflowLogId: 'log',
        },
        { signal: cancelled.signal }
      )
      expect(result.success).toBe(false)
      expect(getInferenceFacts(result.output)).toBeUndefined()
      const completed = await logger.completeWorkflowExecution({ ...completion, success: false })
      expect(completed.cost).toMatchObject({
        status: 'partial',
        availableTotal: 2.25 + (!unpriced && funding === 'account' ? 0.01 : 0),
        tokens: { total: 250 },
      })
      expect(state.ledgers.user).toMatchObject({
        totalCost: completed.cost.availableTotal,
        totalTokensUsed: 250,
        totalApiCalls: 1,
      })
      expect(state.log.executionData.billing.nativeUsage.retrieval.cost).toMatchObject({
        status: unpriced ? 'unavailable' : 'estimated',
        ...(funding === 'byok' ? { accountCost: null } : {}),
      })
      await logger.settleWorkflowExecutionUsage('execution')
      expect(state.ledgers.user?.totalCost).toBe(completed.cost.availableTotal)
      expect(state.emit).toHaveBeenCalledOnce()
    }
  )

  it('uses persisted observations once even when returned traces contain their aggregates', async () => {
    await observe('child', span(0.5, 30).inference)
    const aggregate = {
      ...span(500, 999).inference,
      toolResults: [{ toolCallId: 'child', inference: span(500, 999).inference }],
    }
    const completed = await logger.completeWorkflowExecution({
      ...completion,
      traceSpans: [{ ...span(), inference: aggregate }],
    })
    expect(completed.cost).toMatchObject({ total: 2.75, tokens: { total: 180 } })
    expect(completed.executionData.traceSpans?.[0].inference?.cost?.total).toBe(500)
    expect(state.ledgers.user).toMatchObject({ totalCost: 2.75, totalTokensUsed: 180 })
  })

  it('upgrades late completed work once using the frozen quote without emitting completion again', async () => {
    state.modelMultiplier.mockReturnValue(3)
    await beginWorkflowModelUsage(usageScope, 'late')
    await logger.completeWorkflowExecution({ ...completion, success: false })
    expect(state.ledgers.user?.totalCost).toBe(6.25)
    state.modelMultiplier.mockReturnValue(9)
    await recordModelUsage(
      usageScope,
      { totalTokens: 100 },
      { total: 0.01, status: 'estimated' },
      'late'
    )
    expect(state.log.cost).toMatchObject({
      total: expect.closeTo(6.28, 12),
      tokens: { total: 250 },
    })
    expect(state.ledgers.user).toMatchObject({
      totalCost: expect.closeTo(6.28, 12),
      totalTokensUsed: 250,
      totalApiCalls: 1,
    })
    expect(
      await recordModelUsage(
        usageScope,
        { totalTokens: 999 },
        { total: 999, status: 'estimated' },
        'late'
      )
    ).toMatchObject({ total: 0.01 })
    await expect(beginWorkflowModelUsage(usageScope, 'new-after-terminal')).rejects.toThrow(
      'Workflow execution is not accepting model requests'
    )
    expect(state.ledgers.user?.totalCost).toBeCloseTo(6.28, 12)
    expect(state.modelMultiplier).toHaveBeenCalledOnce()
    expect(state.emit).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'settles a late owned attempt immediately only while paused (paused=%s)',
    async (paused) => {
      state.modelMultiplier.mockReturnValue(3)
      await beginWorkflowModelUsage(usageScope, 'in-flight')
      if (paused) state.log.executionData.pause = { revision: 2 }
      await logger.settleWorkflowExecutionUsage('execution')
      expect(state.ledgers.user?.totalCost).toBe(6.25)
      expect(state.log.endedAt).toBeNull()
      state.modelMultiplier.mockReturnValue(9)

      await recordModelUsage(
        usageScope,
        { totalTokens: 100 },
        { total: 0.01, status: 'estimated' },
        'in-flight'
      )
      expect(state.log.executionData.billing.nativeUsage['in-flight']).toMatchObject({
        tokens: { total: 100 },
        cost: { total: 0.01 },
      })
      expect(state.ledgers.user).toMatchObject({
        totalCost: expect.closeTo(paused ? 6.28 : 6.25, 12),
        totalTokensUsed: paused ? 250 : 150,
        totalApiCalls: 1,
      })
      // A resumed active run still waits for its next checkpoint/terminal settlement.
      if (!paused) await logger.settleWorkflowExecutionUsage('execution')
      await recordModelUsage(
        usageScope,
        { totalTokens: 100 },
        { total: 0.01, status: 'estimated' },
        'in-flight'
      )
      expect(state.log.cost).toMatchObject({
        total: expect.closeTo(6.28, 12),
        tokens: { total: 250 },
      })
      expect(state.ledgers.user?.totalCost).toBeCloseTo(6.28, 12)
      expect(state.modelMultiplier).toHaveBeenCalledOnce()
      expect(state.log.endedAt).toBeNull()
      expect(state.emit).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    'updates paused cost status for a newly begun unknown attempt (paused=%s)',
    async (paused) => {
      state.modelMultiplier.mockReturnValue(3)
      if (paused) state.log.executionData.pause = { revision: 2 }
      await logger.settleWorkflowExecutionUsage('execution')
      expect(state.log.cost).toMatchObject({ total: 6.25, status: 'reported' })
      const charged = structuredClone(state.ledgers.user)

      expect(await beginWorkflowModelUsage(usageScope, 'new-unknown-attempt')).toBe(true)
      if (paused) {
        expect(state.log.cost).toMatchObject({ status: 'partial', availableTotal: 6.25 })
        expect(state.log.cost.total).toBeUndefined()
      } else {
        expect(state.log.cost).toMatchObject({ total: 6.25, status: 'reported' })
      }
      expect(await beginWorkflowModelUsage(usageScope, 'new-unknown-attempt')).toBe(true)
      expect(state.ledgers.user).toEqual(charged)
      expect(Object.keys(state.log.executionData.billing.nativeUsage)).toHaveLength(2)
      expect(state.emit).not.toHaveBeenCalled()
      if (!paused) await logger.settleWorkflowExecutionUsage('execution')
      expect(state.log.cost).toMatchObject({ status: 'partial', availableTotal: 6.25 })
      expect(state.log.cost.total).toBeUndefined()
      expect(state.ledgers.user).toEqual(charged)
    }
  )

  it('commits late observations before ledger settlement and retries without double charging', async () => {
    await beginWorkflowModelUsage(usageScope, 'late')
    await logger.completeWorkflowExecution(completion)
    state.failLedger = true
    await expect(
      recordModelUsage(
        usageScope,
        { totalTokens: 100 },
        { total: 0.01, status: 'estimated' },
        'late'
      )
    ).rejects.toThrow('ledger unavailable')
    expect(state.log.executionData.billing.nativeUsage.late).toMatchObject({
      tokens: { total: 100 },
      cost: { total: 0.01 },
    })
    expect(state.ledgers.user?.totalCost).toBe(2.25)
    state.failLedger = false
    await recordModelUsage(
      usageScope,
      { totalTokens: 100 },
      { total: 0.01, status: 'estimated' },
      'late'
    )
    await recordModelUsage(
      usageScope,
      { totalTokens: 100 },
      { total: 0.01, status: 'estimated' },
      'late'
    )
    expect(state.ledgers.user).toMatchObject({
      totalCost: 2.26,
      totalTokensUsed: 250,
      totalApiCalls: 1,
    })
    expect(state.emit).toHaveBeenCalledOnce()
  })

  it('retains concurrent distinct attempts and refuses mismatched observation identities', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => observe(`parallel-${index}`, span(1, 3).inference))
    )
    expect(Object.keys(state.log.executionData.billing.nativeUsage)).toHaveLength(6)
    await expect(
      beginWorkflowModelUsage({ ...usageScope, actorUserId: 'foreign' }, 'foreign')
    ).rejects.toThrow('Workflow execution is not accepting model requests')
    expect(state.log.executionData.billing.nativeUsage.foreign).toBeUndefined()
    await expect(
      recordModelUsage(
        { ...usageScope, model: 'other-model' },
        {},
        { total: 1, status: 'reported' },
        'native-initial'
      )
    ).rejects.toThrow('identity changed')
    await expect(
      recordModelUsage(
        { ...usageScope, funding: 'byok' },
        {},
        { total: 1, status: 'reported' },
        'native-initial'
      )
    ).rejects.toThrow('identity changed')
    const completed = await logger.completeWorkflowExecution(completion)
    expect(completed.cost).toMatchObject({ total: 7.25, tokens: { total: 165 } })
  })
})

describe('canonical workflow usage settlement', () => {
  it.each(['user', 'organization', 'organization_member'])(
    'preserves each committed %s usage interval when notifications are delayed',
    async (scopeType) => {
      state.settings.mockResolvedValue({ billingEnabled: true, workflowExecutionChargeUsd: 0 })
      state.context.scopeType = scopeType
      if (scopeType !== 'user') {
        state.context.scopeId = 'organization'
        state.context.billingOwner = { type: 'organization', organizationId: 'organization' }
      }
      const ledger = state.ledgers[scopeType === 'organization_member' ? 'member' : scopeType]!
      Object.assign(ledger, { totalCost: 79, currentPeriodCost: 79 })
      if (scopeType === 'organization_member')
        Object.assign(state.ledgers.organization!, { totalCost: 179, currentPeriodCost: 179 })

      const first = await db.transaction((tx) =>
        logger.settleWorkflowExecutionUsage('execution', tx)
      )
      state.log.executionData.traceSpans = [span(4, 300)]
      await observe('second-native-step', span(2, 150).inference)
      const second = await db.transaction((tx) =>
        logger.settleWorkflowExecutionUsage('execution', tx)
      )
      expect(ledger.currentPeriodCost).toBe(83)
      expect(state.email).not.toHaveBeenCalled()
      await logger.notifyWorkflowUsage(first)
      await logger.notifyWorkflowUsage(second)
      expect(
        state.email.mock.calls.map(([receipt]) => [
          receipt.percentBefore,
          receipt.percentAfter,
          receipt.currentUsageAfter,
        ])
      ).toEqual([
        [79, 81, 81],
        [81, 83, 83],
      ])
      await logger.settleWorkflowExecutionUsage('execution')
      expect(ledger).toMatchObject({ totalCost: 83, totalTokensUsed: 300, totalApiCalls: 1 })
      expect(state.email).toHaveBeenCalledTimes(2)
      expect(state.threshold).toHaveBeenCalledTimes(2)
      if (scopeType === 'organization_member')
        expect(state.ledgers.organization?.currentPeriodCost).toBe(183)
    }
  )

  it.each([true, false])(
    'settles pause, resumed work and terminal state exactly once (success=%s)',
    async (success) => {
      state.log.executionData.pause = { revision: 1 }
      await Promise.all(
        Array.from({ length: 3 }, () => logger.settleWorkflowExecutionUsage('execution'))
      )
      expect(state.ledgers.user).toMatchObject({
        totalCost: 2.25,
        totalTokensUsed: 150,
        totalApiCalls: 1,
      })
      expect(state.log.endedAt).toBeNull()
      expect(state.log.executionData.pause).toBeDefined()

      state.log.executionData.pause = undefined
      state.log.executionData.traceSpans = [span(3, 300)]
      await observe('second-native-step', span(1, 150).inference)
      await logger.settleWorkflowExecutionUsage('execution')
      expect(state.ledgers.user).toMatchObject({
        totalCost: 3.25,
        totalTokensUsed: 300,
        totalApiCalls: 1,
      })
      const result = await logger.completeWorkflowExecution({
        ...completion,
        success,
        traceSpans: [span(3, 300)],
        billable: success,
        failureReason: success ? undefined : 'Workflow execution was cancelled',
        variables: { next: 'value' },
      })
      await logger.completeWorkflowExecution({ ...completion, totalDurationMs: 9999 })
      expect(state.ledgers.user).toMatchObject({
        totalCost: 3.25,
        totalTokensUsed: 300,
        totalApiCalls: 1,
      })
      expect(result.cost).toMatchObject({ total: 3.25, modelCost: 3, baseExecutionCharge: 0.25 })
      expect(result.executionData).toMatchObject({
        untouched: 'preserve',
        finalOutput: { done: true },
        environment: { userId: 'actor', variables: { next: 'value' } },
      })
      expect(result.executionData).not.toHaveProperty('checkpoint')
      expect(result.executionData).not.toHaveProperty('pause')
      expect(result.level).toBe(success ? 'info' : 'error')
      expect(state.emit).toHaveBeenCalledExactlyOnceWith(result)
      expect(state.contextLookup).toHaveBeenCalledWith(
        { workspaceId: 'workspace', actorUserId: 'actor' },
        expect.objectContaining({ select: expect.any(Function) })
      )
      expect(state.locks).toContain(workflowExecutionLogs)
      expect(state.locks).toContain(userStats)
    }
  )

  it('charges the configured workflow fee while leaving unavailable model prices unavailable', async () => {
    const unknown = {
      ...span(),
      inference: {
        model: 'model',
        cost: { status: 'unavailable' as const },
        tokens: { total: 150 },
        generatedFields: [],
      },
    }
    await replaceObservations(unknown.inference)
    const result = await logger.completeWorkflowExecution({ ...completion, traceSpans: [unknown] })
    expect(result.cost.total).toBeUndefined()
    expect(result.cost.modelCost).toBeUndefined()
    expect(result.cost).toMatchObject({ status: 'partial', availableTotal: 0.25 })
    expect(state.ledgers.user).toMatchObject({ totalCost: 0.25, totalTokensUsed: 150 })
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user?.totalCost).toBe(0.25)
  })

  it('settles published model tariffs once, including costs marked as estimates', async () => {
    const original = span()
    const priced = {
      ...original,
      inference: {
        ...original.inference,
        cost: { ...original.inference.cost, estimated: true, status: 'estimated' as const },
      },
    }
    await replaceObservations(priced.inference)
    const result = await logger.completeWorkflowExecution({ ...completion, traceSpans: [priced] })
    expect(result.cost).toMatchObject({ total: 2.25, modelCost: 2, estimated: true })
    expect(state.ledgers.user).toMatchObject({ totalCost: 2.25, totalTokensUsed: 150 })
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user?.totalCost).toBe(2.25)
  })

  it('reports BYOK provider estimates without charging them to the Studio ledger', async () => {
    const original = span()
    const byok = {
      ...original,
      inference: { ...original.inference, cost: { ...original.inference.cost, accountCost: null } },
    }
    state.modelMultiplier.mockReturnValue(3)
    await replaceObservations(byok.inference)
    const result = await logger.completeWorkflowExecution({ ...completion, traceSpans: [byok] })
    expect(result.cost).toMatchObject({ total: 0.25, modelCost: 0, baseExecutionCharge: 0.25 })
    expect(result.executionData.traceSpans?.[0].inference?.cost).toMatchObject({
      total: 2,
      accountCost: null,
    })
    expect(state.ledgers.user).toMatchObject({ totalCost: 0.25, totalTokensUsed: 150 })
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user?.totalCost).toBe(0.25)
  })

  it('charges mixed funding once using the saved Studio quote and preserves BYOK step estimates', async () => {
    const byok = {
      ...span(),
      inference: { ...span().inference, cost: { ...span().inference.cost, accountCost: null } },
    }
    const account = { ...span(1, 100), id: 'account' }
    state.log.executionData.traceSpans = [byok, account]
    await replaceObservations(byok.inference, account.inference)
    state.modelMultiplier.mockReturnValue(3)
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user?.totalCost).toBe(3.25)
    state.modelMultiplier.mockReturnValue(9)
    await observe('second-account-step', span(1, 100).inference)
    const result = await logger.completeWorkflowExecution({
      ...completion,
      traceSpans: [byok, { ...span(2, 200), id: 'account' }],
    })
    expect(result.cost).toMatchObject({
      total: 6.25,
      modelCost: 6,
      baseExecutionCharge: 0.25,
      models: { model: { total: 6, tokens: { total: 350 } } },
    })
    expect(state.ledgers.user).toMatchObject({
      totalCost: result.cost?.total,
      totalTokensUsed: 350,
    })
    expect(state.modelMultiplier).toHaveBeenCalledOnce()
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user?.totalCost).toBe(6.25)
  })

  it('accrues nested native model costs once', async () => {
    const original = span()
    const nested = {
      toolCallId: 'native-tool',
      inference: {
        cost: { total: 0.5, status: 'estimated' as const, estimated: true },
        tokens: { total: 30 },
        generatedFields: ['cost', 'tokens'],
      },
    }
    const priced = {
      ...original,
      inference: { ...original.inference, toolResults: [nested, nested] },
    }
    await observe('nested-native-step', nested.inference)
    const result = await logger.completeWorkflowExecution({ ...completion, traceSpans: [priced] })
    expect(result.cost).toMatchObject({ modelCost: 2.5, estimated: true })
    expect(state.ledgers.user).toMatchObject({ totalCost: 2.75, totalTokensUsed: 180 })
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user?.totalCost).toBe(2.75)
  })

  it.each([true, false])(
    'retains model costs and configured multiplier when billable=%s',
    async (billable) => {
      state.modelMultiplier.mockReturnValue(1.5)
      state.baseMultiplier.mockReturnValue(2)
      const result = await logger.completeWorkflowExecution({
        ...completion,
        success: false,
        billable,
      })
      expect(result.cost).toMatchObject({
        total: billable ? 3.5 : 3,
        baseExecutionCharge: billable ? 0.5 : 0,
        input: 2.25,
        output: 0.75,
        modelCost: 3,
        tokens: { total: 150 },
        models: { model: { total: 3, tokens: { total: 150 } } },
      })
      expect(state.ledgers.user).toMatchObject({
        totalCost: billable ? 3.5 : 3,
        totalTokensUsed: 150,
      })
    }
  )

  it('does not reprice prior work after tier changes while paused', async () => {
    state.log.executionData.pause = { revision: 1 }
    state.modelMultiplier.mockReturnValue(1.5)
    await logger.settleWorkflowExecutionUsage('execution')
    state.modelMultiplier.mockReturnValue(3)
    state.baseMultiplier.mockReturnValue(4)
    state.log.executionData.pause = undefined
    await observe('resumed-native-step', span(1, 150).inference)
    await logger.completeWorkflowExecution({ ...completion, traceSpans: [span(3, 300)] })
    expect(state.ledgers.user).toMatchObject({
      totalCost: 4.75,
      totalTokensUsed: 300,
      totalApiCalls: 1,
    })
    expect(state.modelMultiplier).toHaveBeenCalledOnce()
    expect(state.baseMultiplier).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'respects disabled billing even if previously quoted: %s',
    async (quoted) => {
      if (quoted) await logger.settleWorkflowExecutionUsage('execution')
      state.settings.mockResolvedValue({ billingEnabled: false, workflowExecutionChargeUsd: 0.25 })
      await logger.completeWorkflowExecution({
        ...completion,
        success: false,
        traceSpans: [span(3, 300)],
      })
      expect(state.ledgers.user).toMatchObject({
        totalCost: quoted ? 2.25 : 0,
        totalTokensUsed: quoted ? 150 : 0,
        totalApiCalls: quoted ? 1 : 0,
      })
    }
  )

  it.each([0, 150])('counts a free execution with %s tokens only once', async (tokens) => {
    state.settings.mockResolvedValue({ billingEnabled: true, workflowExecutionChargeUsd: 0 })
    state.log.executionData.traceSpans = [span(0, tokens)]
    await replaceObservations(span(0, tokens).inference)
    await logger.settleWorkflowExecutionUsage('execution')
    await logger.completeWorkflowExecution({ ...completion, traceSpans: [span(0, tokens)] })
    expect(state.ledgers.user).toMatchObject({
      totalCost: 0,
      totalTokensUsed: tokens,
      totalApiCalls: 1,
    })
    expect(state.threshold).not.toHaveBeenCalled()
    expect(state.email).not.toHaveBeenCalled()
  })

  it.each(['organization', 'organization_member'])(
    'uses the shared ledger for %s',
    async (scopeType) => {
      state.context.scopeType = scopeType
      state.context.scopeId = 'organization'
      state.context.billingOwner = { type: 'organization', organizationId: 'organization' }
      await logger.settleWorkflowExecutionUsage('execution')
      await logger.settleWorkflowExecutionUsage('execution')
      expect(state.ledgers.organization).toMatchObject({
        totalCost: 2.25,
        totalTokensUsed: 150,
        totalApiCalls: 1,
      })
      expect(state.ledgers.member?.totalCost).toBe(scopeType === 'organization_member' ? 2.25 : 0)
      expect(state.ledgers.user?.totalCost).toBe(0)
    }
  )

  it.each(['ledger', 'watermark', 'missing_member'])(
    'rolls back every accrued amount on %s failure',
    async (failure) => {
      state.failLedger = failure === 'ledger'
      state.failWatermark = failure === 'watermark'
      if (failure === 'missing_member') {
        state.context.scopeType = 'organization_member'
        state.context.billingOwner = { type: 'organization', organizationId: 'organization' }
        state.ledgers.member = null
      }
      await expect(logger.settleWorkflowExecutionUsage('execution')).rejects.toThrow()
      expect(state.log.executionData.billing.nativeUsage['native-initial']).toMatchObject({
        ...span().inference,
        generatedFields: ['model', 'tokens', 'cost'],
      })
      expect(state.log.executionData.billing.quote).toBeUndefined()
      expect(state.log.executionData.billing.accountedCost).toBeUndefined()
      expect(state.ledgers.user?.totalCost).toBe(0)
      expect(state.ledgers.organization?.totalCost).toBe(0)
      expect(state.threshold).not.toHaveBeenCalled()
      state.failLedger = state.failWatermark = false
      state.ledgers.member ??= {}
      await logger.settleWorkflowExecutionUsage('execution')
      const ledger = failure === 'missing_member' ? state.ledgers.organization : state.ledgers.user
      expect(ledger).toMatchObject({ totalCost: 2.25, totalTokensUsed: 150, totalApiCalls: 1 })
    }
  )

  it.each(['pricing', 'ledger'])(
    'keeps terminal results and completion emission durable during %s outages',
    async (failure) => {
      if (failure === 'pricing')
        state.settings.mockRejectedValueOnce(new Error('pricing unavailable'))
      else state.failLedger = true
      await expect(
        logger.completeWorkflowExecution({ ...completion, totalDurationMs: 0 })
      ).rejects.toThrow('unavailable')
      expect(state.log).toMatchObject({
        level: 'info',
        totalDurationMs: 0,
        endedAt: new Date(completion.endedAt),
        executionData: { finalOutput: { done: true }, traceSpans: [span()] },
        cost: { total: 2, tokens: { total: 150 } },
      })
      expect(state.log.executionData).not.toHaveProperty('pause')
      expect(state.emit).toHaveBeenCalledOnce()
      expect(state.ledgers.user?.totalCost).toBe(0)
      state.failLedger = false
      await logger.settleWorkflowExecutionUsage('execution')
      const retry = await logger.completeWorkflowExecution({ ...completion, totalDurationMs: 9999 })
      expect(retry.totalDurationMs).toBe(0)
      expect(state.ledgers.user).toMatchObject({
        totalCost: 2.25,
        totalTokensUsed: 150,
        totalApiCalls: 1,
      })
      expect(state.emit).toHaveBeenCalledOnce()
    }
  )

  it('does not reapply ledger increments when notification or threshold billing fails', async () => {
    state.threshold.mockRejectedValue(new Error('stripe unavailable'))
    state.email.mockRejectedValue(new Error('mail unavailable'))
    await logger.settleWorkflowExecutionUsage('execution')
    await logger.settleWorkflowExecutionUsage('execution')
    expect(state.ledgers.user).toMatchObject({
      totalCost: 2.25,
      totalTokensUsed: 150,
      totalApiCalls: 1,
    })
    expect(state.email).toHaveBeenCalledOnce()
    expect(state.threshold).toHaveBeenCalledOnce()
  })
})
