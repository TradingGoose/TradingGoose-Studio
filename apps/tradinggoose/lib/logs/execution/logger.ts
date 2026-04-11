import { db } from '@tradinggoose/db'
import {
  organization,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  userStats,
  user as userTable,
  workflowExecutionLogs,
} from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  getOrganizationBillingLedger,
  getOrganizationMemberBillingLedger,
} from '@/lib/billing/core/organization'
import { checkUsageStatus, maybeSendUsageThresholdEmail } from '@/lib/billing/core/usage'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import {
  getTierDisplayName,
  getTierUsageAllowanceUsd,
  isFreeBillingTier,
} from '@/lib/billing/tiers'
import { resolveWorkflowBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import type {
  BlockOutputData,
  ExecutionEnvironment,
  ExecutionTrigger,
  ExecutionLoggerService as IExecutionLoggerService,
  TraceSpan,
  WorkflowExecutionLog,
  WorkflowExecutionSnapshot,
  WorkflowState,
} from '@/lib/logs/types'

export interface ToolCall {
  name: string
  duration: number // in milliseconds
  startTime: string // ISO timestamp
  endTime: string // ISO timestamp
  status: 'success' | 'error'
  input?: Record<string, any>
  output?: Record<string, any>
  error?: string
}

const logger = createLogger('ExecutionLogger')

type OrganizationBillingOwner = {
  type: 'organization'
  organizationId: string
}

function getOrganizationBillingOwner(
  billingOwner:
    | {
        type: 'user'
        userId: string
      }
    | OrganizationBillingOwner
): OrganizationBillingOwner | null {
  return billingOwner.type === 'organization' ? billingOwner : null
}

function readExecutionActorUserId(executionData: Record<string, unknown>): string | null {
  const environment = executionData.environment
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    return null
  }

  const userId = (environment as { userId?: unknown }).userId
  return typeof userId === 'string' && userId.length > 0 ? userId : null
}

export class ExecutionLogger implements IExecutionLoggerService {
  async startWorkflowExecution(params: {
    workflowId: string
    executionId: string
    trigger: ExecutionTrigger
    environment: ExecutionEnvironment
    workflowState: WorkflowState
  }): Promise<{
    workflowLog: WorkflowExecutionLog
    snapshot: WorkflowExecutionSnapshot
  }> {
    const { workflowId, executionId, trigger, environment, workflowState } = params

    logger.debug(`Starting workflow execution ${executionId} for workflow ${workflowId}`)

    const snapshotResult = await snapshotService.createSnapshotWithDeduplication(
      workflowId,
      workflowState
    )

    const startTime = new Date()

    const [workflowLog] = await db
      .insert(workflowExecutionLogs)
      .values({
        id: uuidv4(),
        workflowId,
        executionId,
        stateSnapshotId: snapshotResult.snapshot.id,
        level: 'info',
        trigger: trigger.type,
        startedAt: startTime,
        endedAt: null,
        totalDurationMs: null,
        executionData: {
          environment,
          trigger,
        },
      })
      .returning()

    logger.debug(`Created workflow log ${workflowLog.id} for execution ${executionId}`)

    return {
      workflowLog: {
        id: workflowLog.id,
        workflowId: workflowLog.workflowId,
        executionId: workflowLog.executionId,
        stateSnapshotId: workflowLog.stateSnapshotId,
        level: workflowLog.level as 'info' | 'error',
        trigger: workflowLog.trigger as ExecutionTrigger['type'],
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.endedAt?.toISOString() || workflowLog.startedAt.toISOString(),
        totalDurationMs: workflowLog.totalDurationMs || 0,
        executionData: workflowLog.executionData as WorkflowExecutionLog['executionData'],
        createdAt: workflowLog.createdAt.toISOString(),
      },
      snapshot: snapshotResult.snapshot,
    }
  }

  async completeWorkflowExecution(params: {
    executionId: string
    endedAt: string
    totalDurationMs: number
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
      baseExecutionCharge: number
      modelCost: number
      models: Record<
        string,
        {
          input: number
          output: number
          total: number
          tokens: { prompt: number; completion: number; total: number }
        }
      >
    }
    finalOutput: BlockOutputData
    traceSpans?: TraceSpan[]
    workflowInput?: any
  }): Promise<WorkflowExecutionLog> {
    const {
      executionId,
      endedAt,
      totalDurationMs,
      costSummary,
      finalOutput,
      traceSpans,
      workflowInput,
    } = params

    logger.debug(`Completing workflow execution ${executionId}`)

    // Determine if workflow failed by checking trace spans for errors
    const hasErrors = traceSpans?.some((span: any) => {
      const checkSpanForErrors = (s: any): boolean => {
        if (s.status === 'error') return true
        if (s.children && Array.isArray(s.children)) {
          return s.children.some(checkSpanForErrors)
        }
        return false
      }
      return checkSpanForErrors(span)
    })

    const level = hasErrors ? 'error' : 'info'

    // Extract files from trace spans, final output, and workflow input
    const executionFiles = this.extractFilesFromExecution(traceSpans, finalOutput, workflowInput)

    const [existingLog] = await db
      .select({
        id: workflowExecutionLogs.id,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!existingLog) {
      throw new Error(`Workflow log not found for execution ${executionId}`)
    }

    const existingExecutionData =
      existingLog.executionData && typeof existingLog.executionData === 'object'
        ? (existingLog.executionData as Record<string, unknown>)
        : {}

    const mergedExecutionData = {
      ...existingExecutionData,
      traceSpans,
      finalOutput,
      tokenBreakdown: {
        prompt: costSummary.totalPromptTokens,
        completion: costSummary.totalCompletionTokens,
        total: costSummary.totalTokens,
      },
      models: costSummary.models,
    }
    const actorUserId = readExecutionActorUserId(existingExecutionData)

    const [updatedLog] = await db
      .update(workflowExecutionLogs)
      .set({
        level,
        endedAt: new Date(endedAt),
        totalDurationMs,
        files: executionFiles.length > 0 ? executionFiles : null,
        executionData: mergedExecutionData,
        cost: {
          total: costSummary.totalCost,
          baseExecutionCharge: costSummary.baseExecutionCharge,
          modelCost: costSummary.modelCost,
          input: costSummary.totalInputCost,
          output: costSummary.totalOutputCost,
          tokens: {
            prompt: costSummary.totalPromptTokens,
            completion: costSummary.totalCompletionTokens,
            total: costSummary.totalTokens,
          },
          models: costSummary.models,
        },
      })
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .returning()

    if (!updatedLog) {
      throw new Error(`Workflow log not found for execution ${executionId}`)
    }

    try {
      const billingContext = await resolveWorkflowBillingContext({
        workflowId: updatedLog.workflowId,
        actorUserId,
      })
      const [billingUser] = await db
        .select({ id: userTable.id, email: userTable.email, name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, billingContext.billingUserId))
        .limit(1)

      const costDelta = costSummary.totalCost
      const planName = getTierDisplayName(billingContext.tier)

      if (billingContext.scopeType === 'user' && billingUser?.email) {
        const before = await checkUsageStatus(billingContext.billingUserId)

        await this.updateUsageLedger(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          actorUserId
        )

        const limit = before.usageData.limit
        const percentBefore = before.usageData.percentUsed
        const percentAfter =
          limit > 0 ? Math.min(100, percentBefore + (costDelta / limit) * 100) : percentBefore
        const currentUsageAfter = before.usageData.currentUsage + costDelta

        await maybeSendUsageThresholdEmail({
          scope: 'user',
          userId: billingContext.billingUserId,
          userEmail: billingUser.email,
          userName: billingUser.name || undefined,
          planName,
          isFreeTier: isFreeBillingTier(billingContext.tier),
          percentBefore,
          percentAfter,
          currentUsageAfter,
          limit,
        })
      } else if (billingContext.scopeType === 'organization_member') {
        const organizationBillingOwner = getOrganizationBillingOwner(billingContext.billingOwner)

        await this.updateUsageLedger(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          actorUserId
        )

        if (organizationBillingOwner && billingUser?.email) {
          const memberLedger = await getOrganizationMemberBillingLedger(
            organizationBillingOwner.organizationId,
            billingContext.billingUserId
          )

          const limit = getTierUsageAllowanceUsd(
            billingContext.subscription?.tier ?? billingContext.tier
          )
          const beforeUsage = memberLedger?.currentPeriodCost ?? 0
          const percentBefore = limit > 0 ? Math.min(100, (beforeUsage / limit) * 100) : 0
          const currentUsageAfter = beforeUsage + costDelta
          const percentAfter =
            limit > 0 ? Math.min(100, (currentUsageAfter / limit) * 100) : percentBefore

          await maybeSendUsageThresholdEmail({
            scope: 'user',
            userId: billingContext.billingUserId,
            userEmail: billingUser.email,
            userName: billingUser.name || undefined,
            planName,
            isFreeTier: isFreeBillingTier(billingContext.tier),
            percentBefore,
            percentAfter,
            currentUsageAfter,
            limit,
          })
        }
      } else if (billingContext.scopeType === 'organization') {
        const [billingLedger, orgRows] = await Promise.all([
          getOrganizationBillingLedger(billingContext.scopeId),
          db
            .select({ orgUsageLimit: organization.orgUsageLimit })
            .from(organization)
            .where(eq(organization.id, billingContext.scopeId))
            .limit(1),
        ])

        let orgLimit = 0
        const { getBillingTierPricing } = await import('@/lib/billing/core/billing')
        const { usageAllowance } = getBillingTierPricing(billingContext.subscription)
        if (orgRows.length > 0 && orgRows[0].orgUsageLimit) {
          const configured = Number.parseFloat(orgRows[0].orgUsageLimit)
          orgLimit = Math.max(configured, usageAllowance)
        } else {
          orgLimit = usageAllowance
        }

        const orgUsageBeforeNum = billingLedger?.currentPeriodCost ?? 0

        await this.updateUsageLedger(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          actorUserId
        )

        const percentBefore = orgLimit > 0 ? Math.min(100, (orgUsageBeforeNum / orgLimit) * 100) : 0
        const currentUsageAfter = orgUsageBeforeNum + costDelta
        const percentAfter =
          orgLimit > 0 ? Math.min(100, (currentUsageAfter / orgLimit) * 100) : percentBefore

        await maybeSendUsageThresholdEmail({
          scope: 'organization',
          organizationId: billingContext.scopeId,
          planName,
          isFreeTier: false,
          percentBefore,
          percentAfter,
          currentUsageAfter,
          limit: orgLimit,
        })
      } else {
        await this.updateUsageLedger(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          actorUserId
        )
      }
    } catch (e) {
      try {
        await this.updateUsageLedger(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          actorUserId
        )
      } catch {}
      logger.warn('Usage threshold notification check failed (non-fatal)', { error: e })
    }

    logger.debug(`Completed workflow execution ${executionId}`)

    const completedLog: WorkflowExecutionLog = {
      id: updatedLog.id,
      workflowId: updatedLog.workflowId,
      executionId: updatedLog.executionId,
      stateSnapshotId: updatedLog.stateSnapshotId,
      level: updatedLog.level as 'info' | 'error',
      trigger: updatedLog.trigger as ExecutionTrigger['type'],
      startedAt: updatedLog.startedAt.toISOString(),
      endedAt: updatedLog.endedAt?.toISOString() || endedAt,
      totalDurationMs: updatedLog.totalDurationMs || totalDurationMs,
      executionData: updatedLog.executionData as WorkflowExecutionLog['executionData'],
      cost: updatedLog.cost as any,
      createdAt: updatedLog.createdAt.toISOString(),
    }

    emitWorkflowExecutionCompleted(completedLog).catch((error) => {
      logger.error('Failed to emit workflow execution completed event', {
        error,
        executionId,
      })
    })

    return completedLog
  }

  async getWorkflowExecution(executionId: string): Promise<WorkflowExecutionLog | null> {
    const [workflowLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!workflowLog) return null

    return {
      id: workflowLog.id,
      workflowId: workflowLog.workflowId,
      executionId: workflowLog.executionId,
      stateSnapshotId: workflowLog.stateSnapshotId,
      level: workflowLog.level as 'info' | 'error',
      trigger: workflowLog.trigger as ExecutionTrigger['type'],
      startedAt: workflowLog.startedAt.toISOString(),
      endedAt: workflowLog.endedAt?.toISOString() || workflowLog.startedAt.toISOString(),
      totalDurationMs: workflowLog.totalDurationMs || 0,
      executionData: workflowLog.executionData as WorkflowExecutionLog['executionData'],
      cost: workflowLog.cost as any,
      createdAt: workflowLog.createdAt.toISOString(),
    }
  }

  /**
   * Updates the active billing ledger with cost and token information.
   * Maintains the same runtime billing accounting path for both user and organization scopes.
   */
  private async updateUsageLedger(
    workflowId: string,
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
      baseExecutionCharge: number
      modelCost: number
    },
    trigger: ExecutionTrigger['type'],
    actorUserId?: string | null
  ): Promise<void> {
    if (!(await isBillingEnabledForRuntime())) {
      logger.debug('Billing is disabled, skipping billing ledger cost update')
      return
    }

    if (costSummary.totalCost <= 0) {
      logger.debug('No cost to update in billing ledger')
      return
    }

    try {
      const billingContext = await resolveWorkflowBillingContext({
        workflowId,
        actorUserId,
      })
      const isOrganizationScope = billingContext.scopeType === 'organization'
      const organizationBillingOwner = getOrganizationBillingOwner(billingContext.billingOwner)
      const isOrganizationMemberScope =
        billingContext.scopeType === 'organization_member' && organizationBillingOwner !== null
      const billingTargetId = isOrganizationScope
        ? billingContext.scopeId
        : billingContext.billingUserId
      const costToStore = costSummary.totalCost

      if (isOrganizationScope) {
        const billingLedger = await getOrganizationBillingLedger(billingTargetId)
        if (!billingLedger) {
          logger.error('Billing ledger record not found - should be created during onboarding', {
            billingTargetId,
            billingScopeType: billingContext.scopeType,
            trigger,
          })
          return
        }
      } else if (isOrganizationMemberScope && organizationBillingOwner) {
        const organizationId = organizationBillingOwner.organizationId
        const [organizationLedger, memberLedger] = await Promise.all([
          getOrganizationBillingLedger(organizationId),
          getOrganizationMemberBillingLedger(organizationId, billingTargetId),
        ])

        if (!organizationLedger || !memberLedger) {
          logger.error('Billing ledger record not found - should be created during onboarding', {
            billingTargetId,
            billingScopeType: billingContext.scopeType,
            organizationId,
            trigger,
          })
          return
        }
      } else {
        const existing = await db
          .select()
          .from(userStats)
          .where(eq(userStats.userId, billingTargetId))
        if (existing.length === 0) {
          logger.error('Billing ledger record not found - should be created during onboarding', {
            billingTargetId,
            billingScopeType: billingContext.scopeType,
            trigger,
          })
          return
        }
      }

      const updateFields: any = {
        totalTokensUsed: sql`total_tokens_used + ${costSummary.totalTokens}`,
        totalCost: sql`total_cost + ${costToStore}`,
        currentPeriodCost: sql`current_period_cost + ${costToStore}`,
        lastActive: new Date(),
      }

      switch (trigger) {
        case 'manual':
          updateFields.totalManualExecutions = sql`total_manual_executions + 1`
          break
        case 'api':
          updateFields.totalApiCalls = sql`total_api_calls + 1`
          break
        case 'webhook':
          updateFields.totalWebhookTriggers = sql`total_webhook_triggers + 1`
          break
        case 'schedule':
          updateFields.totalScheduledExecutions = sql`total_scheduled_executions + 1`
          break
        case 'chat':
          updateFields.totalChatExecutions = sql`total_chat_executions + 1`
          break
      }

      if (isOrganizationScope) {
        updateFields.updatedAt = new Date()
      }

      if (isOrganizationScope) {
        await db
          .update(organizationBillingLedger)
          .set(updateFields)
          .where(eq(organizationBillingLedger.organizationId, billingTargetId))
      } else if (isOrganizationMemberScope && organizationBillingOwner) {
        const organizationId = organizationBillingOwner.organizationId

        await Promise.all([
          db
            .update(organizationMemberBillingLedger)
            .set({
              ...updateFields,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(organizationMemberBillingLedger.organizationId, organizationId),
                eq(organizationMemberBillingLedger.userId, billingTargetId)
              )
            ),
          db
            .update(organizationBillingLedger)
            .set({
              ...updateFields,
              updatedAt: new Date(),
            })
            .where(eq(organizationBillingLedger.organizationId, organizationId)),
        ])
      } else {
        await db.update(userStats).set(updateFields).where(eq(userStats.userId, billingTargetId))
      }

      logger.debug('Updated billing ledger record with cost data', {
        billingTargetId,
        billingScopeType: billingContext.scopeType,
        trigger,
        addedCost: costToStore,
        addedTokens: costSummary.totalTokens,
      })

      // Check if user has hit overage threshold and bill incrementally
      await checkAndBillOverageThreshold({
        userId: actorUserId ?? billingContext.billingUserId,
        workspaceId: billingContext.workspaceId,
        workflowId,
      })
    } catch (error) {
      logger.error('Error updating billing ledger with cost information', {
        workflowId,
        error,
        costSummary,
      })
      // Don't throw - we want execution to continue even if billing ledger update fails
    }
  }

  /**
   * Extract file references from execution trace spans, final output, and workflow input
   */
  private extractFilesFromExecution(
    traceSpans?: any[],
    finalOutput?: any,
    workflowInput?: any
  ): any[] {
    const files: any[] = []
    const seenFileIds = new Set<string>()

    // Helper function to extract files from any object
    const extractFilesFromObject = (obj: any, source: string) => {
      if (!obj || typeof obj !== 'object') return

      // Check if this object has files property
      if (Array.isArray(obj.files)) {
        for (const file of obj.files) {
          if (file?.name && file.key && file.id) {
            if (!seenFileIds.has(file.id)) {
              seenFileIds.add(file.id)
              files.push({
                id: file.id,
                name: file.name,
                size: file.size,
                type: file.type,
                url: file.url,
                key: file.key,
                uploadedAt: file.uploadedAt,
                expiresAt: file.expiresAt,
                storageProvider: file.storageProvider,
                bucketName: file.bucketName,
              })
            }
          }
        }
      }

      // Check if this object has attachments property (for Gmail and other tools)
      if (Array.isArray(obj.attachments)) {
        for (const file of obj.attachments) {
          if (file?.name && file.key && file.id) {
            if (!seenFileIds.has(file.id)) {
              seenFileIds.add(file.id)
              files.push({
                id: file.id,
                name: file.name,
                size: file.size,
                type: file.type,
                url: file.url,
                key: file.key,
                uploadedAt: file.uploadedAt,
                expiresAt: file.expiresAt,
                storageProvider: file.storageProvider,
                bucketName: file.bucketName,
              })
            }
          }
        }
      }

      // Check if this object itself is a file reference
      if (obj.name && obj.key && typeof obj.size === 'number') {
        if (!obj.id) {
          logger.warn(`File object missing ID, skipping: ${obj.name}`)
          return
        }

        if (!seenFileIds.has(obj.id)) {
          seenFileIds.add(obj.id)
          files.push({
            id: obj.id,
            name: obj.name,
            size: obj.size,
            type: obj.type,
            url: obj.url,
            key: obj.key,
            uploadedAt: obj.uploadedAt,
            expiresAt: obj.expiresAt,
            storageProvider: obj.storageProvider,
            bucketName: obj.bucketName,
          })
        }
      }

      // Recursively check nested objects and arrays
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => extractFilesFromObject(item, `${source}[${index}]`))
      } else if (typeof obj === 'object') {
        Object.entries(obj).forEach(([key, value]) => {
          extractFilesFromObject(value, `${source}.${key}`)
        })
      }
    }

    // Extract files from trace spans
    if (traceSpans && Array.isArray(traceSpans)) {
      traceSpans.forEach((span, index) => {
        extractFilesFromObject(span, `trace_span_${index}`)
      })
    }

    // Extract files from final output
    if (finalOutput) {
      extractFilesFromObject(finalOutput, 'final_output')
    }

    // Extract files from workflow input
    if (workflowInput) {
      extractFilesFromObject(workflowInput, 'workflow_input')
    }

    logger.debug(`Extracted ${files.length} file(s) from execution`, {
      fileNames: files.map((f) => f.name),
    })

    return files
  }
}

export const executionLogger = new ExecutionLogger()
