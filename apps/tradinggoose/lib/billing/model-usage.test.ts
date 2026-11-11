/** @vitest-environment node */

import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import {
  organizationBillingLedger,
  organizationMemberBillingLedger,
  userStats,
} from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, it, vi } from 'vitest'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import type { NativeCost } from '@/lib/mastra/usage'
import { usageProcessors } from '@/lib/mastra/usage-processors'
import { assertModelUsageAllowed, type ModelUsageScope, recordModelUsage } from './model-usage'
import type { BillingTierRecord } from './tiers'
import type { WorkspaceBillingContext } from './workspace-billing'

const fixture = vi.hoisted(() => ({
  enabled: vi.fn(),
  limits: vi.fn(),
  workspace: vi.fn(),
  workflow: vi.fn(),
  transaction: vi.fn(),
  threshold: vi.fn(),
  execution: vi.fn(),
  writes: [] as { table: unknown; where: SQL; values: Record<string, SQL> }[],
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: fixture.transaction,
    select: () => ({
      from: () => ({ where: (query: SQL) => ({ limit: () => fixture.execution(query) }) }),
    }),
  },
}))
vi.mock('@/lib/billing/settings', () => ({ isBillingEnabledForRuntime: fixture.enabled }))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: fixture.limits,
}))
vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: fixture.workspace,
  resolveWorkflowBillingContext: fixture.workflow,
}))
vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: fixture.threshold,
}))

const scope: ModelUsageScope = {
  actorUserId: 'actor',
  workspaceId: 'workspace',
  runId: 'run',
  purpose: 'copilot',
  model: 'openai/gpt-4.1',
}
const usage = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
const cost = { total: 1.25, currency: 'USD', status: 'reported' as const }
const unknownCosts: NativeCost[] = [
  { status: 'unavailable' },
  { status: 'partial', availableTotal: 1.25 },
  { status: 'reported' },
  { status: 'reported', total: 1, currency: 'EUR' },
]
const dialect = new PgDialect()
const parameters = (value: SQL) => dialect.sqlToQuery(value).params
const context = (overrides: Partial<WorkspaceBillingContext> = {}): WorkspaceBillingContext => ({
  workspaceId: 'workspace',
  actorUserId: 'actor',
  billingUserId: 'owner',
  billingOwner: { type: 'user', userId: 'owner' },
  subscription: null,
  tier: { copilotCostMultiplier: '3' } as BillingTierRecord,
  scopeId: 'owner',
  scopeType: 'user',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  fixture.writes.length = 0
  fixture.enabled.mockResolvedValue(true)
  fixture.limits.mockResolvedValue({ isExceeded: false })
  fixture.workspace.mockResolvedValue(context())
  fixture.workflow.mockResolvedValue(context())
  fixture.threshold.mockResolvedValue(undefined)
  fixture.execution.mockReset().mockResolvedValue([])
  fixture.transaction.mockImplementation(async (operation) =>
    operation({
      select: () => ({
        from: () => ({ where: () => ({ for: async () => [{ currentPeriodCost: '0' }] }) }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, SQL>) => ({
          where: (where: SQL) => ({
            returning: async () => {
              fixture.writes.push({ table, where, values })
              return [{ currentPeriodCost: '3.75' }]
            },
          }),
        }),
      }),
    })
  )
})

it.each(['copilot', 'title', 'wand'])(
  'accrues %s USD with the existing tier multiplier and Copilot subcounters',
  async (purpose) => {
    await recordModelUsage({ ...scope, purpose }, usage, cost)
    expect(fixture.workspace).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'workspace',
      actorUserId: 'actor',
    })
    expect(fixture.enabled).toHaveBeenCalledOnce()
    expect(fixture.writes).toHaveLength(1)
    const write = fixture.writes[0]
    expect(write.table).toBe(userStats)
    expect(parameters(write.where)).toEqual(['owner'])
    for (const key of [
      'totalCost',
      'currentPeriodCost',
      'totalCopilotCost',
      'currentPeriodCopilotCost',
    ])
      expect(parameters(write.values[key])).toEqual([3.75])
    expect(parameters(write.values.totalTokensUsed)).toEqual([15])
    expect(parameters(write.values.totalCopilotTokens)).toEqual([15])
    expect(fixture.threshold).toHaveBeenCalledExactlyOnceWith({
      userId: 'actor',
      workspaceId: 'workspace',
      workflowId: undefined,
    })
  }
)

it.each(['organization', 'organization_member'] as const)(
  'updates the canonical %s ledgers without charging the actor personal ledger',
  async (scopeType) => {
    fixture.workspace.mockResolvedValue(
      context({
        billingOwner: { type: 'organization', organizationId: 'org' },
        billingUserId: 'member',
        scopeType,
        scopeId: 'org',
      })
    )
    await recordModelUsage(scope, usage, cost)
    expect(fixture.writes.map((write) => write.table)).toEqual(
      scopeType === 'organization'
        ? [organizationBillingLedger]
        : [organizationBillingLedger, organizationMemberBillingLedger]
    )
    expect(parameters(fixture.writes[0].where)).toEqual(['org'])
    if (scopeType === 'organization_member')
      expect(parameters(fixture.writes[1].where)).toEqual(['org', 'member'])
    for (const write of fixture.writes)
      expect(parameters(write.values.currentPeriodCopilotCost)).toEqual([3.75])
  }
)

it('resolves a workflow tier once and passes its existing billing context through accrual', async () => {
  await recordModelUsage({ ...scope, workflowId: 'workflow' }, usage, cost)
  expect(fixture.workflow).toHaveBeenCalledExactlyOnceWith({
    workflowId: 'workflow',
    actorUserId: 'actor',
  })
  expect(fixture.workspace).not.toHaveBeenCalled()
  expect(parameters(fixture.writes[0].values.currentPeriodCost)).toEqual([3.75])
})

it('resolves personal usage through the existing workspace billing resolver', async () => {
  fixture.workspace.mockResolvedValue(context({ workspaceId: null, billingUserId: 'actor' }))
  await recordModelUsage({ ...scope, workspaceId: null }, usage, cost)
  expect(fixture.workspace).toHaveBeenCalledExactlyOnceWith({
    workspaceId: null,
    actorUserId: 'actor',
  })
  expect(parameters(fixture.writes[0].where)).toEqual(['actor'])
})

it('charges workflow-scoped requests without a verified settlement execution', async () => {
  await recordModelUsage({ ...scope, purpose: 'workflow-provider' }, usage, cost)
  expect(parameters(fixture.writes[0].values.currentPeriodCost)).toEqual([1.25])
  expect(fixture.writes[0].values).not.toHaveProperty('totalCopilotCost')
  fixture.writes.length = 0
  await recordModelUsage(
    { ...scope, purpose: 'workflow-agent', workflowId: 'workflow' },
    usage,
    cost
  )
  expect(fixture.writes).toHaveLength(1)
  expect(parameters(fixture.writes[0].values.currentPeriodCost)).toEqual([1.25])
  expect(fixture.workflow).toHaveBeenCalledOnce()
})

it('defers only to an active execution matching the workflow, workspace and authenticated actor', async () => {
  fixture.execution.mockResolvedValue([{ id: 'active-log' }])
  await recordModelUsage(
    { ...scope, purpose: 'workflow-provider', workflowId: 'workflow', executionId: 'execution' },
    usage,
    cost
  )
  expect(fixture.execution).toHaveBeenCalledOnce()
  const query = dialect.sqlToQuery(fixture.execution.mock.calls[0][0])
  expect(query.params).toEqual(['workflow', 'workspace', 'execution', 'actor'])
  expect(query.sql).toMatch(/"workflow_id" = \$1/)
  expect(query.sql).toMatch(/"workspace_id" = \$2/)
  expect(query.sql).toMatch(/"execution_id" = \$3/)
  expect(query.sql).toMatch(/"ended_at" is null/)
  expect(query.sql).toContain("->'environment'->>'userId' = $4")
  expect(fixture.writes).toHaveLength(0)
  expect(fixture.workflow).not.toHaveBeenCalled()
})

it('accrues model usage when no matching active execution exists', async () => {
  await recordModelUsage(
    { ...scope, purpose: 'workflow-provider', workflowId: 'workflow', executionId: 'execution' },
    usage,
    cost
  )
  expect(fixture.execution).toHaveBeenCalledOnce()
  expect(parameters(fixture.writes[0].values.currentPeriodCost)).toEqual([1.25])
  expect(parameters(fixture.writes[0].values.totalTokensUsed)).toEqual([15])
})

it.each([
  { total: 0, status: 'reported' as const },
  { total: 0, status: 'estimated' as const },
  { total: 1.25, status: 'estimated' as const },
])('accepts an explicit complete USD cost %j', async (completeCost) => {
  await recordModelUsage(scope, usage, completeCost)
  expect(parameters(fixture.writes[0].values.currentPeriodCopilotCost)).toEqual([
    completeCost.total * 3,
  ])
})

it.each(
  ['copilot', 'title', 'wand'].flatMap((purpose) =>
    unknownCosts.map((unknownCost) => ({ purpose, unknownCost }))
  )
)(
  'records Copilot calls and tokens without unknown USD increments: %j',
  async ({ purpose, unknownCost }) => {
    await recordModelUsage({ ...scope, purpose }, usage, unknownCost)

    expect(fixture.writes).toHaveLength(1)
    const write = fixture.writes[0]
    expect(parameters(write.values.totalCost)).toEqual([0])
    expect(parameters(write.values.currentPeriodCost)).toEqual([0])
    expect(parameters(write.values.totalTokensUsed)).toEqual([15])
    expect(parameters(write.values.totalCopilotTokens)).toEqual([15])
    expect(dialect.sqlToQuery(write.values.totalCopilotCalls).sql).toBe('total_copilot_calls + 1')
    expect(write.values).not.toHaveProperty('totalCopilotCost')
    expect(write.values).not.toHaveProperty('currentPeriodCopilotCost')
    expect(fixture.threshold).not.toHaveBeenCalled()
  }
)

it.each(unknownCosts)(
  'preserves rejection of unknown USD for non-Copilot calls: %j',
  async (unknownCost) => {
    await expect(
      recordModelUsage({ ...scope, purpose: 'workflow-provider' }, usage, unknownCost)
    ).rejects.toThrow('Model cost is unavailable')
    expect(fixture.workspace).not.toHaveBeenCalled()
    expect(fixture.transaction).not.toHaveBeenCalled()
  }
)

it.each([
  { status: 'reported' as const, total: Number.NaN },
  { status: 'reported' as const, total: -1 },
  { status: 'estimated' as const, total: Number.POSITIVE_INFINITY },
  { status: 'partial' as const, total: -1 },
])(
  'refuses malformed reported totals rather than treating them as unknown: %j',
  async (invalidCost) => {
    await expect(recordModelUsage(scope, usage, invalidCost)).rejects.toThrow(
      'Model cost is unavailable'
    )
    expect(fixture.workspace).not.toHaveBeenCalled()
    expect(fixture.transaction).not.toHaveBeenCalled()
  }
)

it('completes successful native inference for a new unpriced Copilot model with billing enabled', async () => {
  const accounting = await usageProcessors({ ...scope, model: 'openai/new-unpriced-model' })
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'unpriced-copilot-test',
    name: 'Unpriced Copilot test',
    instructions: '',
    model: new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Completed answer' }],
        usage,
        finishReason: 'stop',
        warnings: [],
      }),
    }),
    inputProcessors: accounting.inputProcessors,
    outputProcessors: accounting.outputProcessors,
  })

  const response = await agent.generate('hello', { runId: scope.runId, maxSteps: 1 })

  expect(response.text).toBe('Completed answer')
  await expect(accounting.verifyComplete()).resolves.toBeUndefined()
  expect(accounting.getUsage()).toEqual(usage)
  expect(accounting.getCost()).toMatchObject({ status: 'unavailable' })
  expect(accounting.getCost()).not.toHaveProperty('total')
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.writes[0].values).not.toHaveProperty('totalCopilotCost')
})

it('checks limits but skips accrual when billing is disabled', async () => {
  fixture.enabled.mockResolvedValue(false)
  await assertModelUsageAllowed(scope)
  await recordModelUsage(scope, usage, { status: 'unavailable' })
  expect(fixture.workspace).not.toHaveBeenCalled()
  expect(fixture.transaction).not.toHaveBeenCalled()
})

it('rejects usage-limit exhaustion for the resolved scope before model admission', async () => {
  fixture.limits.mockResolvedValue({ isExceeded: true, message: 'Allowance exhausted' })
  await expect(assertModelUsageAllowed(scope)).rejects.toMatchObject({ status: 402 })
  expect(fixture.limits).toHaveBeenCalledExactlyOnceWith({
    userId: 'actor',
    workspaceId: 'workspace',
    workflowId: undefined,
  })
})
