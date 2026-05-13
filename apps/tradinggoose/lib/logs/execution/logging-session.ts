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
  variables?: Record<string, string>
  triggerData?: Record<string, unknown>
}

export interface SessionCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  finalOutput?: any
  traceSpans?: any[]
  workflowInput?: any
  workspaceId?: string
  actorUserId?: string | null
}

export interface SessionErrorCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  error?: {
    message?: string
    stackTrace?: string
  }
  traceSpans?: TraceSpan[]
  workspaceId?: string
  actorUserId?: string | null
}

export class LoggingSession {
  private trigger?: ExecutionTrigger
  private environment?: ExecutionEnvironment

  constructor(
    private workflowId: string,
    private executionId: string,
    private triggerType: ExecutionTrigger['type'],
    private requestId?: string,
    private workflowLogId?: string
  ) {}

  async start(params: SessionStartParams): Promise<string> {
    const { userId, workspaceId, workflowState, variables, triggerData } = params

    try {
      this.trigger = createTriggerObject(this.triggerType, triggerData)
      this.environment = createEnvironmentObject(
        this.workflowId,
        this.executionId,
        userId,
        workspaceId,
        variables
      )
      const workflowSummary = await loadWorkflowSummaryForExecution(this.workflowId)

      const { workflowLog } = await executionLogger.startWorkflowExecution({
        workflowId: this.workflowId,
        executionId: this.executionId,
        trigger: this.trigger,
        environment: this.environment,
        workflowState,
        workflowSummary,
      })
      this.workflowLogId = workflowLog.id

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Started logging for execution ${this.executionId}`)
      }

      return workflowLog.id
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to start logging:`, error)
      }
      throw error
    }
  }

  private async resolveWorkflowExecutionPricing(params?: {
    workspaceId?: string
    actorUserId?: string | null
  }): Promise<{
    workflowExecutionChargeUsd: number
    workflowModelCostMultiplier: number
  }> {
    const billingSettings = await getResolvedBillingSettings()

    if (!billingSettings.billingEnabled) {
      return {
        workflowExecutionChargeUsd: 0,
        workflowModelCostMultiplier: 1,
      }
    }

    const workspaceId = params?.workspaceId ?? this.environment?.workspaceId
    if (!workspaceId) {
      throw new Error('Workflow execution billing requires workspaceId')
    }

    const billingContext = await resolveWorkspaceBillingContext({
      workspaceId,
      actorUserId: params?.actorUserId ?? this.environment?.userId ?? null,
    })

    return {
      workflowExecutionChargeUsd:
        billingSettings.workflowExecutionChargeUsd *
        getTierWorkflowExecutionMultiplier(billingContext.tier),
      workflowModelCostMultiplier: getTierWorkflowModelCostMultiplier(billingContext.tier),
    }
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

  async complete(params: SessionCompleteParams = {}): Promise<void> {
    const {
      endedAt,
      totalDurationMs,
      finalOutput,
      traceSpans,
      workflowInput,
      workspaceId,
      actorUserId,
    } = params

    try {
      const scope = this.resolveCompletionScope({ workspaceId })
      const { workflowExecutionChargeUsd, workflowModelCostMultiplier } =
        await this.resolveWorkflowExecutionPricing({
          workspaceId: scope.workspaceId,
          actorUserId,
        })
      const costSummary = calculateCostSummary(
        traceSpans || [],
        workflowExecutionChargeUsd,
        workflowModelCostMultiplier
      )
      const endTime = endedAt || new Date().toISOString()
      const duration = totalDurationMs || 0

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        workflowLogId: scope.workflowLogId,
        workspaceId: scope.workspaceId,
        endedAt: endTime,
        totalDurationMs: duration,
        costSummary,
        finalOutput: finalOutput === undefined ? {} : finalOutput,
        traceSpans: traceSpans || [],
        workflowInput,
      })

      // Track workflow execution outcome
      if (traceSpans && traceSpans.length > 0) {
        try {
          const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')

          // Determine status from trace spans
          const hasErrors = traceSpans.some((span: any) => {
            const checkForErrors = (s: any): boolean => {
              if (s.status === 'error') return true
              if (s.children && Array.isArray(s.children)) {
                return s.children.some(checkForErrors)
              }
              return false
            }
            return checkForErrors(span)
          })

          trackPlatformEvent('platform.workflow.executed', {
            'workflow.id': this.workflowId,
            'execution.duration_ms': duration,
            'execution.status': hasErrors ? 'error' : 'success',
            'execution.trigger': this.triggerType,
            'execution.blocks_executed': traceSpans.length,
            'execution.has_errors': hasErrors,
            'execution.total_cost': costSummary.totalCost || 0,
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

  async completeWithError(params: SessionErrorCompleteParams = {}): Promise<void> {
    try {
      const { endedAt, totalDurationMs, error, traceSpans, workspaceId, actorUserId } = params
      const scope = this.resolveCompletionScope({ workspaceId })

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0
      const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))
      const { workflowExecutionChargeUsd } = await this.resolveWorkflowExecutionPricing({
        workspaceId: scope.workspaceId,
        actorUserId,
      })

      const costSummary = {
        totalCost: workflowExecutionChargeUsd,
        totalInputCost: 0,
        totalOutputCost: 0,
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        baseExecutionCharge: workflowExecutionChargeUsd,
        modelCost: 0,
        models: {},
      }

      const message = error?.message || 'Execution failed before starting blocks'

      const hasProvidedSpans = Array.isArray(traceSpans) && traceSpans.length > 0

      const errorSpan: TraceSpan = {
        id: 'workflow-error-root',
        name: 'Workflow Error',
        type: 'workflow',
        duration: Math.max(1, durationMs),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        status: 'error',
        ...(hasProvidedSpans ? {} : { children: [] }),
        output: { error: message },
      }

      const spans = hasProvidedSpans ? traceSpans : [errorSpan]

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        workflowLogId: scope.workflowLogId,
        workspaceId: scope.workspaceId,
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { error: message },
        traceSpans: spans,
      })

      // Track workflow execution error outcome
      try {
        const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
        trackPlatformEvent('platform.workflow.executed', {
          'workflow.id': this.workflowId,
          'execution.duration_ms': Math.max(1, durationMs),
          'execution.status': 'error',
          'execution.trigger': this.triggerType,
          'execution.blocks_executed': spans.length,
          'execution.has_errors': true,
          'execution.error_message': message,
        })
      } catch (_e) {
        // Silently fail
      }

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed logging for execution ${this.executionId}`)
      }
    } catch (enhancedError) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to complete logging:`, enhancedError)
      }
      throw enhancedError
    }
  }
}
