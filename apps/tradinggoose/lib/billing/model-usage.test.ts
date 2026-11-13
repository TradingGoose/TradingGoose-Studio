/** @vitest-environment node */
import '@/lib/mastra/__test-utils__/managed-services'
import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import {
  organizationBillingLedger,
  organizationMemberBillingLedger,
  userStats,
  workflowExecutionLogs,
} from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectNativeMessage } from '@/lib/mastra/messages'
import type { NativeCost } from '@/lib/mastra/usage'
import { usageProcessors } from '@/lib/mastra/usage-processors'
import {
  assertModelUsageAllowed,
  beginWorkflowModelUsage,
  type ModelUsageScope,
  recordModelUsage,
} from './model-usage'
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
  personalUsage: vi.fn(),
  organizationLedger: vi.fn(),
  memberLedger: vi.fn(),
  writes: [] as { table: unknown; where: SQL; values: Record<string, SQL> }[],
  executionData: {} as Record<string, any>,
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: fixture.transaction,
    select: () => ({
      from: (table: unknown) => ({
        where: (query: SQL) => ({
          limit: () =>
            table === userStats ? [{ billingBlocked: false }] : fixture.execution(query),
        }),
      }),
    }),
  },
}))
vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: fixture.enabled,
  getResolvedBillingSettings: async () => ({
    billingEnabled: await fixture.enabled(),
    usageWarningThresholdPercent: 80,
  }),
}))
vi.mock('@/lib/billing/core/usage', () => ({ getUserUsageData: fixture.personalUsage }))
vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingLedger: fixture.organizationLedger,
  getOrganizationMemberBillingLedger: fixture.memberLedger,
}))
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
  funding: 'account',
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
  tier: { copilotCostMultiplier: '3', includedUsageLimitUsd: '100' } as BillingTierRecord,
  scopeId: 'owner',
  scopeType: 'user',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  fixture.writes.length = 0
  fixture.executionData = {}
  fixture.enabled.mockResolvedValue(true)
  fixture.limits.mockResolvedValue({ isExceeded: false })
  fixture.workspace.mockResolvedValue(context())
  fixture.workflow.mockResolvedValue(context())
  fixture.threshold.mockResolvedValue(undefined)
  fixture.execution.mockReset().mockResolvedValue([])
  fixture.personalUsage.mockReset()
  fixture.organizationLedger.mockReset()
  fixture.memberLedger.mockReset()
  fixture.transaction.mockImplementation(async (operation) =>
    operation({
      select: () => ({
        from: (table: unknown) => ({
          where: (query: SQL) => {
            const rows = async () =>
              table === workflowExecutionLogs
                ? (await fixture.execution(query)).map((row: any) => ({
                    ...row,
                    executionData: fixture.executionData,
                  }))
                : [{ currentPeriodCost: '0' }]
            return { for: rows, limit: () => ({ for: rows }) }
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, SQL>) => ({
          where: (where: SQL) => {
            if (table === workflowExecutionLogs)
              fixture.executionData = (values as any).executionData
            return {
              returning: async () => {
                fixture.writes.push({ table, where, values })
                return [{ currentPeriodCost: '3.75' }]
              },
            }
          },
        }),
      }),
    })
  )
})

it.each(['copilot', 'title', 'wand'])(
  'accrues %s USD with the existing tier multiplier and Copilot subcounters',
  async (purpose) => {
    const reportedCost = await recordModelUsage({ ...scope, purpose }, usage, cost)
    expect(reportedCost).toEqual({ ...cost, total: 3.75 })
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

it('persists owned attempts for the workflow, workspace and authenticated actor before deferring settlement', async () => {
  fixture.execution.mockResolvedValue([{ id: 'active-log' }])
  const ownedScope = {
    ...scope,
    purpose: 'workflow-provider',
    workflowId: 'workflow',
    executionId: 'execution',
  }
  expect(await beginWorkflowModelUsage(ownedScope, 'attempt')).toBe(true)
  const reportedCost = await recordModelUsage(ownedScope, usage, cost, 'attempt')
  expect(reportedCost).toEqual(cost)
  expect(fixture.execution).toHaveBeenCalledTimes(2)
  const query = dialect.sqlToQuery(fixture.execution.mock.calls[0][0])
  expect(query.params).toEqual(['workflow', 'workspace', 'execution', 'actor'])
  expect(query.sql).toMatch(/"workflow_id" = \$1/)
  expect(query.sql).toMatch(/"workspace_id" = \$2/)
  expect(query.sql).toMatch(/"execution_id" = \$3/)
  expect(query.sql).toContain("->'environment'->>'userId' = $4")
  expect(fixture.executionData.billing.nativeUsage.attempt).toMatchObject({
    model: scope.model,
    cost,
    tokens: { prompt: 12, completion: 3, total: 15 },
  })
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
    expect(await recordModelUsage({ ...scope, purpose }, usage, unknownCost)).toBe(unknownCost)

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

it('skips billing admission and accrual when billing is disabled', async () => {
  fixture.enabled.mockResolvedValue(false)
  await assertModelUsageAllowed(scope)
  expect(await recordModelUsage(scope, usage, cost)).toBe(cost)
  expect(fixture.workspace).not.toHaveBeenCalled()
  expect(fixture.limits).not.toHaveBeenCalled()
  expect(fixture.transaction).not.toHaveBeenCalled()
})

it('reports the same scaled components as the final account charge', async () => {
  expect(
    await recordModelUsage(scope, usage, {
      input: 0.75,
      output: 0.5,
      total: 1.25,
      estimated: true,
      currency: 'USD',
      status: 'estimated',
    })
  ).toEqual({
    input: 2.25,
    output: 1.5,
    total: 3.75,
    estimated: true,
    currency: 'USD',
    status: 'estimated',
  })
  expect(parameters(fixture.writes[0].values.currentPeriodCost)).toEqual([3.75])
})

it('uses the existing model-tier multiplier for direct account-funded model work', async () => {
  fixture.workspace.mockResolvedValue(
    context({ tier: { workflowModelCostMultiplier: '2' } as BillingTierRecord })
  )
  const report = await recordModelUsage({ ...scope, purpose: 'vision' }, usage, cost)
  expect(report).toEqual({ ...cost, total: 2.5 })
  expect(parameters(fixture.writes[0].values.currentPeriodCost)).toEqual([report.total])
})

it('reports BYOK standard estimates without checking or debiting the Studio model balance', async () => {
  fixture.limits.mockResolvedValue({ isExceeded: true, message: 'Allowance exhausted' })
  const byok = { ...scope, funding: 'byok' as const }
  await expect(assertModelUsageAllowed(byok)).resolves.toBeUndefined()
  expect(await recordModelUsage(byok, usage, cost)).toEqual({ ...cost, accountCost: null })
  expect(await recordModelUsage(byok, usage, { status: 'unavailable' })).toEqual({
    status: 'unavailable',
    accountCost: null,
  })
  expect(fixture.enabled).not.toHaveBeenCalled()
  expect(fixture.limits).not.toHaveBeenCalled()
  expect(fixture.workspace).not.toHaveBeenCalled()
  expect(fixture.transaction).not.toHaveBeenCalled()
})

it('persists native dollar reports using the same Studio-tier amount as account usage', async () => {
  const observed = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }
  const accounting = await usageProcessors(scope)
  const agent = new Agent({
    id: 'account-priced-native-report',
    name: 'Account priced native report',
    instructions: '',
    model: new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Completed answer' }],
        usage: observed,
        finishReason: 'stop',
        warnings: [],
      }),
    }),
    inputProcessors: accounting.inputProcessors,
    outputProcessors: accounting.outputProcessors,
  })

  const response = await agent.generate('hello', { runId: scope.runId, maxSteps: 1 })
  await accounting.verifyComplete()
  const report = accounting.getCost()
  expect(report).toMatchObject({
    input: expect.closeTo(0.006, 12),
    output: expect.closeTo(0.0024, 12),
    total: expect.closeTo(0.0084, 12),
    status: 'estimated',
    currency: 'USD',
  })
  const assistant = response.messages.find((message) => message.role === 'assistant')!
  expect(projectNativeMessage(assistant).cost).toEqual(report)
  expect(fixture.writes).toHaveLength(1)
  for (const field of [
    'totalCost',
    'currentPeriodCost',
    'totalCopilotCost',
    'currentPeriodCopilotCost',
  ]) {
    expect(parameters(fixture.writes[0].values[field])).toEqual([report.total])
  }
})

it('persists standard BYOK prices through native generation when the Studio balance is exhausted', async () => {
  fixture.limits.mockResolvedValue({ isExceeded: true, message: 'Allowance exhausted' })
  const nativeScope = { ...scope, funding: 'byok' as const }
  const accounting = await usageProcessors(nativeScope)
  const agent = new Agent({
    id: 'byok-priced-native-report',
    name: 'BYOK priced native report',
    instructions: '',
    model: new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'BYOK answer' }],
        usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
        finishReason: 'stop',
        warnings: [],
      }),
    }),
    inputProcessors: accounting.inputProcessors,
    outputProcessors: accounting.outputProcessors,
  })
  const response = await agent.generate('hello', { runId: nativeScope.runId, maxSteps: 1 })
  await accounting.verifyComplete()
  const report = accounting.getCost()
  expect(report).toMatchObject({ total: 0.0028, status: 'estimated', accountCost: null })
  const assistant = response.messages.find((message) => message.role === 'assistant')!
  expect(projectNativeMessage(assistant).cost).toMatchObject({ total: 0.0028, status: 'estimated' })
  expect(fixture.writes).toEqual([])
  expect(fixture.limits).not.toHaveBeenCalled()
  expect(fixture.workspace).not.toHaveBeenCalled()
})

it('does not claim an account charge when its required ledger is missing', async () => {
  fixture.transaction.mockImplementationOnce(async (operation) =>
    operation({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
    })
  )
  await expect(recordModelUsage(scope, usage, cost)).rejects.toThrow('billing ledger is missing')
  expect(fixture.writes).toEqual([])
  expect(fixture.threshold).not.toHaveBeenCalled()
})

it('rejects usage-limit exhaustion for the resolved scope before model admission', async () => {
  fixture.limits.mockResolvedValue({ isExceeded: true, message: 'Allowance exhausted' })
  await expect(assertModelUsageAllowed(scope)).rejects.toMatchObject({ status: 402 })
  expect(fixture.limits).toHaveBeenCalledExactlyOnceWith({
    userId: 'owner',
    workspaceId: 'workspace',
    workflowId: undefined,
  })
})

describe('native inference admission through the existing usage monitor', () => {
  beforeEach(async () => {
    const monitor = await vi.importActual<typeof import('./calculations/usage-monitor')>(
      './calculations/usage-monitor'
    )
    fixture.limits.mockImplementation(monitor.checkServerSideUsageLimits)
    fixture.personalUsage.mockResolvedValue({ currentUsage: 0, limit: 100, percentUsed: 0 })
    fixture.organizationLedger.mockResolvedValue({ currentPeriodCost: 0, billingBlocked: false })
    fixture.memberLedger.mockResolvedValue({ currentPeriodCost: 0 })
  })

  it.each([
    { ownerUsage: 100, collaboratorUsage: 0, exceeded: true },
    { ownerUsage: 0, collaboratorUsage: 100, exceeded: false },
  ])('checks the charged owner rather than the collaborator: %j', async (scenario) => {
    fixture.personalUsage.mockImplementation(async (userId: string) => ({
      currentUsage: userId === 'owner' ? scenario.ownerUsage : scenario.collaboratorUsage,
      limit: 100,
      percentUsed: userId === 'owner' ? scenario.ownerUsage : scenario.collaboratorUsage,
    }))
    const admission = assertModelUsageAllowed(scope)
    if (scenario.exceeded) {
      await expect(admission).rejects.toMatchObject({ status: 402 })
      expect(fixture.writes).toHaveLength(0)
    } else {
      await admission
      await recordModelUsage(scope, usage, cost)
      expect(parameters(fixture.writes[0].where)).toEqual(['owner'])
      expect(fixture.threshold).toHaveBeenCalledWith({
        userId: 'actor',
        workspaceId: 'workspace',
        workflowId: undefined,
      })
    }
    expect(fixture.personalUsage).toHaveBeenCalledExactlyOnceWith('owner')
    expect(fixture.workspace).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      actorUserId: 'actor',
    })
  })

  it.each(['personal', 'workflow', 'organization', 'organization_member'] as const)(
    'uses the existing %s billing scope for admission and accrual',
    async (kind) => {
      const request = {
        ...scope,
        workspaceId: kind === 'personal' || kind === 'workflow' ? undefined : scope.workspaceId,
        ...(kind === 'workflow' ? { workflowId: 'workflow' } : {}),
      }
      const billing = context(
        kind === 'personal'
          ? {
              workspaceId: null,
              billingUserId: 'actor',
              billingOwner: { type: 'user', userId: 'actor' },
              scopeId: 'actor',
            }
          : kind.startsWith('organization')
            ? {
                billingUserId: 'member',
                billingOwner: { type: 'organization', organizationId: 'org' },
                scopeId: 'org',
                scopeType: kind as 'organization' | 'organization_member',
              }
            : {}
      )
      fixture.workspace.mockResolvedValue(billing)
      fixture.workflow.mockResolvedValue(billing)
      await assertModelUsageAllowed(request)
      await recordModelUsage(request, usage, cost)
      if (kind.startsWith('organization')) {
        expect(fixture.personalUsage).not.toHaveBeenCalled()
        expect(fixture.organizationLedger).toHaveBeenCalledExactlyOnceWith('org')
        expect(fixture.writes[0].table).toBe(organizationBillingLedger)
        if (kind === 'organization_member') {
          expect(fixture.memberLedger).toHaveBeenCalledExactlyOnceWith('org', 'member')
          expect(parameters(fixture.writes[1].where)).toEqual(['org', 'member'])
        } else expect(fixture.memberLedger).not.toHaveBeenCalled()
      } else {
        expect(fixture.personalUsage).toHaveBeenCalledExactlyOnceWith(billing.billingUserId)
        expect(parameters(fixture.writes[0].where)).toEqual([billing.billingUserId])
      }
      expect(fixture.limits).toHaveBeenCalledExactlyOnceWith({
        userId: billing.billingUserId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
      })
    }
  )
})

it('does not admit an aborted request while resolving disabled billing', async () => {
  const controller = new AbortController()
  fixture.enabled.mockImplementationOnce(async () => {
    controller.abort()
    return false
  })
  await expect(assertModelUsageAllowed({ ...scope, signal: controller.signal })).rejects.toBe(
    controller.signal.reason
  )
  expect(fixture.limits).not.toHaveBeenCalled()
  expect(fixture.workspace).not.toHaveBeenCalled()
})
