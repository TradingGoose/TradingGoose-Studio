import { getResolvedBillingSettings } from '@/lib/billing/settings'
import {
  getTierWorkflowExecutionMultiplier,
  getTierWorkflowModelCostMultiplier,
} from '@/lib/billing/tiers'
import { resolveWorkspaceBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
  loadWorkflowSummaryForExecution,
} from '@/lib/logs/execution/logging-factory'
import type {
  ExecutionEnvironment,
  ExecutionTrigger,
  TraceSpan,
  WorkflowState,
} from '@/lib/logs/types'

const logger = createLogger('LoggingSession')

export interface SessionStartParams {
  userId?: string
  workspaceId: string
  workflowState: WorkflowState
  triggerData?: Record<string, unknown>
}

export interface SessionCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  finalOutput?: any
  success: boolean
  failureReason?: string
  traceSpans?: TraceSpan[]
  workflowInput?: any
  workspaceId?: string
  actorUserId?: string | null
  hasResponseBlock?: boolean
  variables?: Record<string, string>
  billable?: boolean
}

export class LoggingSession {
  private environment?: ExecutionEnvironment

  constructor(
    private workflowId: string,
    private executionId: string,
    private triggerType: ExecutionTrigger['type'],
    private requestId?: string,
    private workflowLogId?: string
  ) {}

  async start(params: SessionStartParams): Promise<string> {
    const { userId, workspaceId, workflowState, triggerData } = params

    const trigger = createTriggerObject(this.triggerType, triggerData)
    this.environment = createEnvironmentObject(
      this.workflowId,
      this.executionId,
      userId,
      workspaceId
    )
    const workflowSummary = await loadWorkflowSummaryForExecution(this.workflowId)

    const { workflowLog } = await executionLogger.startWorkflowExecution({
      workflowId: this.workflowId,
      executionId: this.executionId,
      trigger,
      environment: this.environment,
      workflowState,
      workflowSummary,
    })
    this.workflowLogId = workflowLog.id

    if (this.requestId) {
      logger.debug(`[${this.requestId}] Started logging for execution ${this.executionId}`)
    }

    return workflowLog.id
  }

  private async resolveWorkflowExecutionPricingForCompletion(params: {
    workspaceId: string
    actorUserId?: string | null
  }) {
    try {
      const billingSettings = await getResolvedBillingSettings()
      if (billingSettings.billingEnabled) {
        const billingContext = await resolveWorkspaceBillingContext({
          workspaceId: params.workspaceId,
          actorUserId: params.actorUserId ?? this.environment?.userId ?? null,
        })
        return {
          workflowExecutionChargeUsd:
            billingSettings.workflowExecutionChargeUsd *
            getTierWorkflowExecutionMultiplier(billingContext.tier),
          workflowModelCostMultiplier: getTierWorkflowModelCostMultiplier(billingContext.tier),
        }
      }
    } catch (error) {
      logger.error(
        this.requestId
          ? `[${this.requestId}] Workflow completion pricing failed`
          : 'Workflow completion pricing failed',
        error
      )
    }
    return { workflowExecutionChargeUsd: 0, workflowModelCostMultiplier: 1 }
  }

  private resolveCompletionScope(params: { workspaceId?: string }): {
    workflowLogId: string
    workspaceId: string
  } {
    if (!this.workflowLogId) {
      throw new Error('Workflow log id is required to complete workflow execution logging')
    }
    const workspaceId = params.workspaceId ?? this.environment?.workspaceId
    if (!workspaceId) {
      throw new Error('Workflow execution billing requires workspaceId')
    }
    return { workflowLogId: this.workflowLogId, workspaceId }
  }

  async complete(params: SessionCompleteParams): Promise<void> {
    const {
      endedAt = new Date().toISOString(),
      totalDurationMs = 0,
      finalOutput = {},
      success,
      failureReason,
      traceSpans = [],
      workflowInput,
      workspaceId,
      actorUserId,
      hasResponseBlock,
      variables,
      billable,
    } = params

    try {
      const scope = this.resolveCompletionScope({ workspaceId })
      const { workflowExecutionChargeUsd, workflowModelCostMultiplier } =
        await this.resolveWorkflowExecutionPricingForCompletion({
          workspaceId: scope.workspaceId,
          actorUserId,
        })
      const costSummary = calculateCostSummary(
        traceSpans,
        billable === false ? 0 : workflowExecutionChargeUsd,
        workflowModelCostMultiplier
      )
      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        workflowLogId: scope.workflowLogId,
        workspaceId: scope.workspaceId,
        endedAt,
        totalDurationMs,
        costSummary,
        finalOutput,
        success,
        failureReason,
        traceSpans,
        workflowInput,
        hasResponseBlock,
        variables,
      })

      // Track workflow execution outcome
      if (!success || traceSpans.length > 0) {
        try {
          const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')

          const failed = !success

          trackPlatformEvent('platform.workflow.executed', {
            'workflow.id': this.workflowId,
            'execution.duration_ms': totalDurationMs,
            'execution.status': failed ? 'error' : 'success',
            'execution.trigger': this.triggerType,
            'execution.blocks_executed': traceSpans.length,
            'execution.has_errors': failed,
            'execution.total_cost': costSummary.totalCost,
            ...(failureReason ? { 'execution.error_message': failureReason } : {}),
          })
        } catch (_e) {
          // Silently fail
        }
      }

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed logging for execution ${this.executionId}`)
      }
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to complete logging:`, error)
      }
      throw error
    }
  }
}
