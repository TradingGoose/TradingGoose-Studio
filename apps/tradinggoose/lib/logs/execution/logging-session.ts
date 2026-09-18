import { createLogger } from '@/lib/logs/console/logger'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
  createEnvironmentObject,
  createTriggerObject,
  loadWorkflowSummaryForExecution,
} from '@/lib/logs/execution/logging-factory'
import type { ExecutionTrigger, TraceSpan, WorkflowState } from '@/lib/logs/types'

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
  workspaceId: string
  hasResponseBlock?: boolean
  variables?: Record<string, string>
  billable?: boolean
}

export class LoggingSession {
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
    const environment = createEnvironmentObject(
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
      environment,
      workflowState,
      workflowSummary,
    })
    this.workflowLogId = workflowLog.id

    if (this.requestId) {
      logger.debug(`[${this.requestId}] Started logging for execution ${this.executionId}`)
    }

    return workflowLog.id
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
      hasResponseBlock,
      variables,
      billable,
    } = params

    try {
      if (!this.workflowLogId) {
        throw new Error('Workflow log id is required to complete workflow execution logging')
      }
      const completed = await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        workflowLogId: this.workflowLogId,
        workspaceId,
        endedAt,
        totalDurationMs,
        billable,
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
            'execution.total_cost': completed.cost.total,
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
