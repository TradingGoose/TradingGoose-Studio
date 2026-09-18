/** @vitest-environment node */
import {
  organizationBillingLedger,
  userStats,
  user as userTable,
  workflowExecutionLogs,
} from '@tradinggoose/db/schema'
import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  getTierUsageAllowanceUsd: () => 10,
  isFreeBillingTier: () => false,
}))
vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingLedger: async () => state.ledgers.organization,
  getOrganizationMemberBillingLedger: async () => state.ledgers.member,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  getBillingTierPricing: () => ({ usageAllowance: 10 }),
}))
vi.mock('@/lib/billing/core/usage', () => ({
  checkUsageStatus: async () => ({
    usageData: { limit: 10, currentUsage: state.ledgers.user?.currentPeriodCost ?? 0 },
  }),
  maybeSendUsageThresholdEmail: state.email,
}))
vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: state.threshold,
}))
vi.mock('@/lib/logs/events', () => ({ emitWorkflowExecutionCompleted: state.emit }))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({ snapshotService: {} }))

const span = (cost = 2, tokens = 150) => ({
  id: 'agent',
  name: 'Agent',
  type: 'agent',
  status: 'success' as const,
  startTime: '2026-09-17T12:00:00Z',
  endTime: '2026-09-17T12:00:01Z',
  duration: 1000,
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

beforeEach(() => {
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
      pause: { revision: 1 },
      traceSpans: [span()],
      untouched: 'preserve',
    },
  }
  logger = new ExecutionLogger()
})

describe('canonical workflow usage settlement', () => {
  it.each([true, false])(
    'settles pause, resumed work and terminal state exactly once (success=%s)',
    async (success) => {
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

      state.log.executionData.traceSpans = [span(3, 300)]
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
    state.modelMultiplier.mockReturnValue(1.5)
    await logger.settleWorkflowExecutionUsage('execution')
    state.modelMultiplier.mockReturnValue(3)
    state.baseMultiplier.mockReturnValue(4)
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
      expect(state.log.executionData.billing).toBeUndefined()
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
