/** @vitest-environment node */
import { db } from '@tradinggoose/db'
import {
  organizationBillingLedger,
  organizationMemberBillingLedger,
  subscription,
  systemBillingSettings,
  systemBillingTier,
  systemSettings,
  userStats,
  workflowExecutionLogs,
  workspace,
} from '@tradinggoose/db/schema'
import { beforeEach, expect, it, vi } from 'vitest'
import { ExecutionLogger } from './logger'

const pool = vi.hoisted(() => ({
  reserved: false,
  tail: Promise.resolve() as Promise<unknown>,
  rows: new Map<unknown, Record<string, any>[]>(),
  reads: new Set<unknown>(),
}))

vi.mock('@tradinggoose/db', async () => {
  const schema = await import('@tradinggoose/db/schema')
  const connection = (pooled: boolean) => {
    const query = (table?: unknown, update?: Record<string, any>) => {
      const chain = {
        from: (target: unknown) => {
          table = target
          return chain
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: () => chain,
        onConflictDoUpdate: () => chain,
        then: (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              // One reserved connection is sufficient to reproduce pool starvation.
              // Reject a second checkout instead of leaving the regression hanging forever.
              if (pooled && pool.reserved) throw new Error('Database pool exhausted')
              pool.reads.add(table)
              const rows = pool.rows.get(table) ?? []
              if (update) {
                if (!rows.length) rows.push(update)
                else Object.assign(rows[0], update)
                pool.rows.set(table, rows)
              }
              return rows
            })
            .then(resolve, reject),
      }
      return chain
    }
    return {
      select: () => query(),
      update: (table: unknown) => ({ set: (values: Record<string, any>) => query(table, values) }),
      insert: (table: unknown) => ({
        values: (values: Record<string, any>) => query(table, values),
      }),
    }
  }
  return {
    ...schema,
    db: {
      ...connection(true),
      transaction: (callback: (tx: ReturnType<typeof connection>) => Promise<unknown>) => {
        const result = pool.tail.then(async () => {
          pool.reserved = true
          try {
            return await callback(connection(false))
          } finally {
            pool.reserved = false
          }
        })
        pool.tail = result.catch(() => {})
        return result
      },
    },
  }
})

vi.mock('@/lib/system-services/stripe-runtime', () => ({ hasStripeSecretKey: () => true }))
vi.mock('@/lib/billing/threshold-billing', () => ({ checkAndBillOverageThreshold: vi.fn() }))
vi.mock('@/lib/billing/core/usage', () => ({}))
vi.mock('@/lib/logs/events', () => ({}))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({ snapshotService: {} }))
vi.mock('@/lib/permissions/utils', () => ({}))

beforeEach(() => {
  pool.reserved = false
  pool.tail = Promise.resolve()
  pool.rows.clear()
  pool.reads.clear()
})

it.each(
  [false, true].flatMap((callerOwned) =>
    ['disabled', 'user', 'organization', 'organization_member', 'default_tier'].map((scope) => ({
      callerOwned,
      scope,
    }))
  )
)(
  'settles $scope using one connection (callerOwned=$callerOwned)',
  async ({ callerOwned, scope }) => {
    const enabled = scope !== 'disabled'
    const ownerType = scope.startsWith('organization') ? 'organization' : 'user'
    const log = {
      id: 'log',
      executionId: 'execution',
      workspaceId: 'workspace',
      trigger: 'api',
      executionData: { environment: { userId: 'actor' }, traceSpans: [] } as Record<string, any>,
    }
    pool.rows.set(workflowExecutionLogs, [log])
    pool.rows.set(systemSettings, [{ billingEnabled: enabled }])
    pool.rows.set(systemBillingSettings, [{ workflowExecutionChargeUsd: '0' }])
    pool.rows.set(workspace, [
      {
        ownerId: 'owner',
        billingOwnerType: ownerType,
        billingOwnerUserId: 'owner',
        billingOwnerOrganizationId: 'org',
      },
    ])
    pool.rows.set(
      subscription,
      scope === 'default_tier'
        ? []
        : [{ referenceType: ownerType, referenceId: 'owner', billingTierId: 'tier' }]
    )
    pool.rows.set(systemBillingTier, [
      { id: 'tier', ownerType, usageScope: scope === 'organization' ? 'pooled' : 'individual' },
    ])
    for (const table of [userStats, organizationBillingLedger, organizationMemberBillingLedger]) {
      pool.rows.set(table, [{}])
    }
    const logger = new ExecutionLogger()
    await Promise.all(
      Array.from({ length: 30 }, () =>
        callerOwned
          ? db.transaction((tx) => logger.settleWorkflowExecutionUsage('execution', tx))
          : logger.settleWorkflowExecutionUsage('execution')
      )
    )
    expect(pool.reserved).toBe(false)
    expect(log.executionData.billing).toMatchObject({ quote: { enabled } })
    expect(log.executionData.billing.counted).toBe(enabled ? true : undefined)
    for (const table of [systemSettings, systemBillingSettings])
      expect(pool.reads.has(table)).toBe(true)
    for (const table of [workspace, subscription, systemBillingTier])
      expect(pool.reads.has(table)).toBe(enabled)
    if (scope === 'default_tier')
      expect(pool.rows.get(subscription)?.[0].id).toBe('sub_default_owner')
  }
)
