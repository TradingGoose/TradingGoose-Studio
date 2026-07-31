import type { WorkflowExecutionLifecycle } from '@/lib/execution/workflow-execution-lifecycle-repository'
import { createWorkflowExecutionRuntime } from '@/lib/execution/workflow-execution-runtime'
import { createLogger } from '@/lib/logs/console/logger'
import type { PortfolioFireCondition } from '@/lib/monitors/portfolio-conditions'
import { PORTFOLIO_MONITOR_PROVIDER, PORTFOLIO_MONITOR_TRIGGER_ID } from '@/lib/monitors/sources'
import { runWorkflowExecution } from '@/lib/workflows/execution-runner'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { disableMonitor } from './monitor-disable'

const logger = createLogger('PortfolioMonitorExecution')

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
  const requestId = executionId.slice(0, 8)
  if (!payload.workflowExecutionLifecycle) {
    throw new Error(`Portfolio workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const deadlineRuntime = createWorkflowExecutionRuntime(
    payload.workflowExecutionLifecycle,
    (error) => logger.error(`[${requestId}] Workflow deadline heartbeat failed`, error)
  )
  try {
    await deadlineRuntime.start()
    deadlineRuntime.signal?.throwIfAborted()
  } catch (error) {
    await deadlineRuntime.settleStartup(deadlineRuntime.signal?.aborted ? 'local_abort' : 'failed')
    deadlineRuntime.close()
    throw error
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

  const { result, dispatchFailureReason } = await runWorkflowExecution({
    workflowId: payload.monitor.workflowId,
    actorUserId: payload.monitor.actorUserId,
    requestId,
    executionId,
    lifecycle: payload.workflowExecutionLifecycle,
    deadlineRuntime,
    triggerType: 'webhook',
    workflowInput,
    executionTarget: 'deployed',
    workflowContext: { workspaceId: payload.monitor.workspaceId },
    triggerTarget: {
      kind: 'block',
      blockId: payload.monitor.blockId,
    },
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
  }).finally(() => deadlineRuntime.close())
  deadlineRuntime.signal?.throwIfAborted()
  if (dispatchFailureReason) {
    await disableMonitor({
      monitorId: payload.monitor.id,
      provider: PORTFOLIO_MONITOR_PROVIDER,
      logger,
      reason: dispatchFailureReason,
      workflowId: payload.monitor.workflowId,
      blockId: payload.monitor.blockId,
    })
  }

  return {
    success: result.success,
    workflowId: payload.monitor.workflowId,
    executionId,
    output: result.output,
    error: result.error,
    executedAt: new Date().toISOString(),
    provider: PORTFOLIO_MONITOR_PROVIDER,
  }
}
