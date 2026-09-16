import { describe, expect, it, vi } from 'vitest'
import { PORTFOLIO_MONITOR_PROVIDER, PORTFOLIO_MONITOR_TRIGGER_ID } from '@/lib/monitors/sources'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { portfolioStateTrigger } from '@/triggers/portfolio/trigger'
import {
  executePortfolioMonitorJob,
  type PortfolioMonitorExecutionPayload,
} from './portfolio-monitor-execution'

const mocks = vi.hoisted(() => ({
  runWorkflowExecution: vi.fn(),
  disableMonitor: vi.fn(),
}))

vi.mock('@/lib/workflows/execution-runner', () => ({
  runWorkflowExecution: mocks.runWorkflowExecution,
}))

vi.mock('./monitor-disable', () => ({ disableMonitor: mocks.disableMonitor }))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))

describe('executePortfolioMonitorJob', () => {
  it('dispatches the declared portfolio object properties without schema metadata', async () => {
    const identity: PortfolioIdentity = {
      providerId: 'alpaca',
      credentialId: 'credential-1',
      serviceId: 'service-1',
      accountId: 'account-1',
      accountName: 'Paper portfolio',
      baseCurrency: 'USD',
    }
    const detail: PortfolioDetail = {
      ...identity,
      environment: 'paper',
      asOf: '2026-09-16T12:00:00.000Z',
      cashBalances: [],
      positions: [],
      orders: [],
      summary: { totalPortfolioValue: 10_000, totalCashValue: 10_000 },
    }
    const payload = {
      executionId: 'execution-1',
      source: PORTFOLIO_MONITOR_PROVIDER,
      monitor: {
        id: 'monitor-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        actorUserId: 'actor-1',
        blockId: 'trigger-block',
        providerId: identity.providerId,
        credentialId: identity.credentialId,
        serviceId: identity.serviceId,
        accountId: identity.accountId,
        condition: {
          root: {
            combinator: 'and',
            rules: [{ metric: 'summary.totalPortfolioValue', operator: 'gte', value: 10_000 }],
          },
        },
      },
      portfolioIdentity: identity,
      portfolioDetail: detail,
    } satisfies PortfolioMonitorExecutionPayload
    mocks.runWorkflowExecution.mockResolvedValue({
      result: { success: true, output: { matched: true } },
    })

    const result = await executePortfolioMonitorJob(payload)

    expect(mocks.runWorkflowExecution).toHaveBeenCalledExactlyOnceWith({
      workflowId: payload.monitor.workflowId,
      actorUserId: payload.monitor.actorUserId,
      requestId: 'executio',
      executionId: payload.executionId,
      triggerType: 'webhook',
      workflowInput: {
        input: 'Portfolio state condition matched for Paper portfolio',
        event: 'portfolio_state_condition_matched',
        portfolio: { identity, detail },
        monitor: {
          id: 'monitor-1',
          workflowId: 'workflow-1',
          blockId: 'trigger-block',
          providerId: 'alpaca',
          serviceId: 'service-1',
          accountId: 'account-1',
        },
        condition: payload.monitor.condition,
      },
      executionTarget: 'deployed',
      workflowContext: { workspaceId: payload.monitor.workspaceId },
      triggerTarget: { kind: 'block', blockId: payload.monitor.blockId },
      triggerData: {
        source: PORTFOLIO_MONITOR_TRIGGER_ID,
        executionTarget: 'deployed',
        monitor: {
          id: 'monitor-1',
          workflowId: 'workflow-1',
          blockId: 'trigger-block',
          providerId: 'alpaca',
          serviceId: 'service-1',
          accountId: 'account-1',
          assetType: 'portfolio',
        },
      },
    })
    const { workflowInput } = mocks.runWorkflowExecution.mock.calls[0][0]
    expect(workflowInput.portfolio.identity).toBe(identity)
    expect(workflowInput.portfolio.detail).toBe(detail)
    expect(workflowInput.condition).toBe(payload.monitor.condition)
    expect(Object.keys(workflowInput.portfolio)).toEqual(
      Object.keys(portfolioStateTrigger.outputs.portfolio.properties)
    )
    expect(Object.keys(workflowInput.monitor)).toEqual(
      Object.keys(portfolioStateTrigger.outputs.monitor.properties)
    )
    expect(mocks.disableMonitor).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      workflowId: payload.monitor.workflowId,
      executionId: payload.executionId,
      output: { matched: true },
      error: undefined,
      executedAt: expect.any(String),
      provider: PORTFOLIO_MONITOR_PROVIDER,
    })
  })
})
