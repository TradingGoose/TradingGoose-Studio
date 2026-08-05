import type { WorkflowExecutionLifecycle } from '@/lib/execution/workflow-execution-lifecycle-repository'
import type { PortfolioFireCondition } from '@/lib/monitors/portfolio-conditions'
import { PORTFOLIO_MONITOR_PROVIDER, PORTFOLIO_MONITOR_TRIGGER_ID } from '@/lib/monitors/sources'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { executeWorkflowJob } from './workflow-execution'

type PortfolioMonitorExecutionMonitor = {
  id: string
  workflowId: string
  workspaceId: string
  actorUserId: string
  blockId: string
  providerId: string
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioFireCondition
}

export type PortfolioMonitorExecutionPayload = {
  executionId?: string
  drainRunId?: string
  workflowExecutionLifecycle?: WorkflowExecutionLifecycle
  source: typeof PORTFOLIO_MONITOR_PROVIDER
  monitor: PortfolioMonitorExecutionMonitor
  portfolioIdentity: PortfolioIdentity
  portfolioDetail: PortfolioDetail
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export function isPortfolioMonitorExecutionPayload(
  value: unknown
): value is PortfolioMonitorExecutionPayload {
  if (!isRecord(value)) return false
  const monitor = value.monitor
  return (
    value.source === PORTFOLIO_MONITOR_PROVIDER &&
    isRecord(monitor) &&
    typeof monitor.id === 'string' &&
    typeof monitor.workflowId === 'string' &&
    typeof monitor.workspaceId === 'string' &&
    typeof monitor.actorUserId === 'string' &&
    typeof monitor.blockId === 'string' &&
    isRecord(value.portfolioIdentity) &&
    isRecord(value.portfolioDetail)
  )
}

export async function executePortfolioMonitorJob(payload: PortfolioMonitorExecutionPayload) {
  const executionId = payload.executionId ?? `portfolio_state:${payload.monitor.id}:${Date.now()}`
  if (!payload.workflowExecutionLifecycle) {
    throw new Error(`Portfolio workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const workflowInput = {
    input: `Portfolio state condition matched for ${payload.portfolioIdentity.accountName ?? payload.portfolioIdentity.accountId}`,
    event: 'portfolio_state_condition_matched',
    portfolio: {
      identity: payload.portfolioIdentity,
      detail: payload.portfolioDetail,
    },
    monitor: {
      id: payload.monitor.id,
      workflowId: payload.monitor.workflowId,
      blockId: payload.monitor.blockId,
      providerId: payload.monitor.providerId,
      serviceId: payload.monitor.serviceId,
      accountId: payload.monitor.accountId,
    },
    condition: payload.monitor.condition,
  }

  const result = await executeWorkflowJob({
    workflowId: payload.monitor.workflowId,
    userId: payload.monitor.actorUserId,
    workspaceId: payload.monitor.workspaceId,
    executionId,
    drainRunId: payload.drainRunId,
    workflowExecutionLifecycle: payload.workflowExecutionLifecycle,
    triggerType: 'webhook',
    input: workflowInput,
    executionTarget: 'deployed',
    triggerBlockId: payload.monitor.blockId,
    triggerData: {
      source: PORTFOLIO_MONITOR_TRIGGER_ID,
      executionTarget: 'deployed',
      monitor: {
        id: payload.monitor.id,
        workflowId: payload.monitor.workflowId,
        blockId: payload.monitor.blockId,
        providerId: payload.monitor.providerId,
        serviceId: payload.monitor.serviceId,
        accountId: payload.monitor.accountId,
        assetType: 'portfolio',
      },
    },
  })

  return {
    success: result.success,
    workflowId: payload.monitor.workflowId,
    executionId,
    output: result.output,
    error: result.error,
    executedAt: result.executedAt,
    provider: PORTFOLIO_MONITOR_PROVIDER,
  }
}
