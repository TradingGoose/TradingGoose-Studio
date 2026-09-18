import { db } from '@tradinggoose/db'
import { organization, user as userTable, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  getOrganizationBillingLedger,
  getOrganizationMemberBillingLedger,
} from '@/lib/billing/core/organization'
import { checkUsageStatus, maybeSendUsageThresholdEmail } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import {
  getTierDisplayName,
  getTierUsageAllowanceUsd,
  getTierWorkflowExecutionMultiplier,
  getTierWorkflowModelCostMultiplier,
  isFreeBillingTier,
} from '@/lib/billing/tiers'
import { accrueUserUsageCost, type UsageTransaction } from '@/lib/billing/usage-accrual'
import {
  resolveWorkspaceBillingContext,
  type WorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import type {
  BlockOutputData,
  ExecutionEnvironment,
  ExecutionTrigger,
  TraceSpan,
  WorkflowExecutionLog,
  WorkflowExecutionSnapshot,
  WorkflowState,
} from '@/lib/logs/types'

const logger = createLogger('ExecutionLogger')

type ExecutionBilling = {
  billable?: boolean
  quote?: { enabled: boolean; baseCharge: number; modelMultiplier: number }
  accountedCost?: number
  accountedTokens?: number
  counted?: boolean
}
type UsageReceipt = {
  context: WorkspaceBillingContext
  workflowId: string | null
  costDelta: number
}

function executionCost(traceSpans: TraceSpan[], quote?: ExecutionBilling['quote']) {
  const summary = calculateCostSummary(
    traceSpans,
    quote?.baseCharge ?? 0,
    quote?.modelMultiplier ?? 1
  )
  return {
    total: summary.totalCost,
    baseExecutionCharge: summary.baseExecutionCharge,
    modelCost: summary.modelCost,
    input: summary.totalInputCost,
    output: summary.totalOutputCost,
    tokens: {
      prompt: summary.totalPromptTokens,
      completion: summary.totalCompletionTokens,
      total: summary.totalTokens,
    },
    models: summary.models,
  }
}

function readExecutionActorUserId(executionData: Record<string, unknown>): string | null {
  const environment = executionData.environment
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    return null
  }

  const userId = (environment as { userId?: unknown }).userId
  return typeof userId === 'string' && userId.length > 0 ? userId : null
}

export class ExecutionLogger {
  async startWorkflowExecution(params: {
    workflowId: string
    executionId: string
    trigger: ExecutionTrigger
    environment: ExecutionEnvironment
    workflowState: WorkflowState
    workflowSummary: WorkflowExecutionLog['workflowSummary']
  }): Promise<{
    workflowLog: WorkflowExecutionLog
    snapshot: WorkflowExecutionSnapshot
  }> {
    const { workflowId, executionId, trigger, environment, workflowState, workflowSummary } = params

    logger.debug(`Starting workflow execution ${executionId} for workflow ${workflowId}`)

    const snapshotResult = await snapshotService.createSnapshotWithDeduplication({
      workflowId,
      workspaceId: environment.workspaceId,
      state: workflowState,
    })

    const startTime = new Date()
    const workflowLogValues = {
      workflowId,
      workspaceId: environment.workspaceId,
      executionId,
      stateSnapshotId: snapshotResult.snapshot.id,
      workflowSummary,
      trigger: trigger.type,
      startedAt: startTime,
    }

    const readWorkflowLog = async () => {
      const [row] = await db
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .limit(1)
      return row
    }
    const writeStartFailureLog = async (error: unknown) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Workflow execution log could not be started'

      await db
        .insert(workflowExecutionLogs)
        .values({
          id: uuidv4(),
          ...workflowLogValues,
          level: 'error',
          endedAt: startTime,
          totalDurationMs: 0,
          executionData: {
            environment,
            trigger,
            traceSpans: [],
            finalOutput: {},
            errorMessage: message,
          },
        })
        .onConflictDoNothing({
          target: workflowExecutionLogs.executionId,
        })
    }

    let workflowLog: typeof workflowExecutionLogs.$inferSelect | undefined
    try {
      ;[workflowLog] = await db
        .insert(workflowExecutionLogs)
        .values({
          id: uuidv4(),
          ...workflowLogValues,
          level: 'info',
          endedAt: null,
          totalDurationMs: null,
          executionData: {
            environment,
            trigger,
          },
        })
        .onConflictDoNothing({
          target: workflowExecutionLogs.executionId,
        })
        .returning()
    } catch (error) {
      workflowLog = await readWorkflowLog()
      if (!workflowLog) {
        await writeStartFailureLog(error)
        throw error
      }
    }

    if (!workflowLog) {
      workflowLog = await readWorkflowLog()
    }

    if (!workflowLog) {
      throw new Error(`Workflow execution log ${executionId} could not be started`)
    }

    if (workflowLog.endedAt) {
      throw new Error(`Workflow execution log ${executionId} is already completed`)
    }

    logger.debug(`Created workflow log ${workflowLog.id} for execution ${executionId}`)

    return {
      workflowLog: {
        id: workflowLog.id,
        workflowId: workflowLog.workflowId,
        workspaceId: workflowLog.workspaceId,
        executionId: workflowLog.executionId,
        stateSnapshotId: workflowLog.stateSnapshotId,
        workflowSummary: workflowLog.workflowSummary as WorkflowExecutionLog['workflowSummary'],
        level: workflowLog.level as 'info' | 'error',
        trigger: workflowLog.trigger as ExecutionTrigger['type'],
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.startedAt.toISOString(),
        totalDurationMs: workflowLog.totalDurationMs || 0,
        executionData: workflowLog.executionData as WorkflowExecutionLog['executionData'],
        createdAt: workflowLog.createdAt.toISOString(),
      },
      snapshot: snapshotResult.snapshot,
    }
  }

  async completeWorkflowExecution(params: {
    executionId: string
    workflowLogId: string
    workspaceId: string
    endedAt: string
    totalDurationMs: number
    finalOutput: BlockOutputData
    success: boolean
    failureReason?: string
    traceSpans?: TraceSpan[]
    workflowInput?: any
    hasResponseBlock?: boolean
    variables?: Record<string, string>
    billable?: boolean
  }): Promise<WorkflowExecutionLog & { cost: ReturnType<typeof executionCost> }> {
    const {
      executionId,
      workflowLogId,
      workspaceId,
      endedAt,
      totalDurationMs,
      finalOutput,
      success,
      failureReason,
      traceSpans = [],
      workflowInput,
      hasResponseBlock,
      variables,
      billable = true,
    } = params
    const workflowLogWhere = and(
      eq(workflowExecutionLogs.id, workflowLogId),
      eq(workflowExecutionLogs.executionId, executionId),
      eq(workflowExecutionLogs.workspaceId, workspaceId)
    )
    const [existingLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(workflowLogWhere)
      .limit(1)
    if (!existingLog) throw new Error(`Workflow log not found for execution ${executionId}`)

    const existingData = existingLog.executionData as Record<string, any>
    const cost = executionCost(traceSpans, existingData.billing?.quote)
    const executionFiles = this.extractFilesFromExecution(traceSpans, finalOutput, workflowInput)
    const completedExecutionData = {
      ...(variables ? { environment: { ...existingData.environment, variables } } : {}),
      traceSpans,
      finalOutput,
      ...(hasResponseBlock ? { hasResponseBlock: true } : {}),
      ...(failureReason ? { errorMessage: failureReason } : {}),
      tokenBreakdown: cost.tokens,
      models: cost.models,
    }

    // Terminal state survives a pricing/ledger outage; settlement retries only accounting.
    const [updatedLog] = await db
      .update(workflowExecutionLogs)
      .set({
        level: success ? 'info' : 'error',
        endedAt: new Date(endedAt),
        totalDurationMs,
        files: executionFiles.length > 0 ? executionFiles : null,
        executionData: sql`(coalesce(${workflowExecutionLogs.executionData}, '{}'::jsonb) || ${JSON.stringify(completedExecutionData)}::jsonb || jsonb_build_object('billing', coalesce(${workflowExecutionLogs.executionData}->'billing', '{}'::jsonb) || ${JSON.stringify({ billable })}::jsonb)) - 'checkpoint' - 'pause'`,
        cost,
      })
      .where(and(workflowLogWhere, isNull(workflowExecutionLogs.endedAt)))
      .returning()

    let settlementFailure: { error: unknown } | undefined
    try {
      await this.settleWorkflowExecutionUsage(executionId)
    } catch (error) {
      settlementFailure = { error }
    }
    const [completedRow] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(workflowLogWhere)
      .limit(1)
    if (!completedRow?.endedAt)
      throw new Error(`Workflow log not found for execution ${executionId}`)

    const completedLog = {
      id: completedRow.id,
      workflowId: completedRow.workflowId,
      workspaceId: completedRow.workspaceId,
      executionId: completedRow.executionId,
      stateSnapshotId: completedRow.stateSnapshotId,
      workflowSummary: completedRow.workflowSummary as WorkflowExecutionLog['workflowSummary'],
      level: completedRow.level as 'info' | 'error',
      trigger: completedRow.trigger as ExecutionTrigger['type'],
      startedAt: completedRow.startedAt.toISOString(),
      endedAt: completedRow.endedAt.toISOString(),
      totalDurationMs: completedRow.totalDurationMs!,
      executionData: completedRow.executionData as WorkflowExecutionLog['executionData'],
      cost: completedRow.cost as ReturnType<typeof executionCost>,
      createdAt: completedRow.createdAt.toISOString(),
    }
    if (updatedLog) {
      emitWorkflowExecutionCompleted(completedLog).catch((error) => {
        logger.error('Failed to emit workflow execution completed event', { error, executionId })
      })
    }
    if (settlementFailure) throw settlementFailure.error
    return completedLog
  }

  /** Settle cumulative work, never execution state. Caller-owned transactions notify after commit. */
  async settleWorkflowExecutionUsage(
    executionId: string,
    transaction?: UsageTransaction
  ): Promise<UsageReceipt | undefined> {
    const settle = async (tx: UsageTransaction): Promise<UsageReceipt | undefined> => {
      const [row] = await tx
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .limit(1)
        .for('update')
      if (!row) throw new Error(`Workflow log not found for execution ${executionId}`)
      const data = row.executionData as Record<string, any>
      const billing: ExecutionBilling = data.billing ?? {}
      let context: WorkspaceBillingContext | undefined
      let quote = billing.quote
      const settings = await getResolvedBillingSettings(tx)
      if (!quote) {
        if (settings.billingEnabled) {
          context = await resolveWorkspaceBillingContext(
            { workspaceId: row.workspaceId, actorUserId: readExecutionActorUserId(data) },
            tx
          )
        }
        quote = {
          enabled: settings.billingEnabled,
          baseCharge:
            context && billing.billable !== false
              ? settings.workflowExecutionChargeUsd *
                getTierWorkflowExecutionMultiplier(context.tier)
              : 0,
          modelMultiplier: context ? getTierWorkflowModelCostMultiplier(context.tier) : 1,
        }
      }
      const cost = executionCost(data.traceSpans ?? [], quote)
      const costDelta = Math.max(0, cost.total - (billing.accountedCost ?? 0))
      const tokenDelta = Math.max(0, cost.tokens.total - (billing.accountedTokens ?? 0))
      let receipt: UsageReceipt | undefined
      if (
        settings.billingEnabled &&
        quote.enabled &&
        (costDelta > 0 || tokenDelta > 0 || !billing.counted)
      ) {
        context ??= await resolveWorkspaceBillingContext(
          { workspaceId: row.workspaceId, actorUserId: readExecutionActorUserId(data) },
          tx
        )
        const counters = {
          manual: ['totalManualExecutions', 'total_manual_executions'],
          api: ['totalApiCalls', 'total_api_calls'],
          webhook: ['totalWebhookTriggers', 'total_webhook_triggers'],
          schedule: ['totalScheduledExecutions', 'total_scheduled_executions'],
          chat: ['totalChatExecutions', 'total_chat_executions'],
        } as const
        const [counter, column] = counters[row.trigger as ExecutionTrigger['type']]
        const accrued = await accrueUserUsageCost(
          {
            userId: readExecutionActorUserId(data) ?? context.billingUserId,
            workspaceId: row.workspaceId,
            workflowId: row.workflowId,
            billingContext: context,
            cost: costDelta,
            extraUpdates: {
              totalTokensUsed: sql`total_tokens_used + ${tokenDelta}`,
              ...(!billing.counted
                ? {
                    [counter]: sql`${sql.raw(column)} + 1`,
                  }
                : {}),
            },
            skipThresholdBilling: true,
            reason: 'workflow_execution',
          },
          tx
        )
        if (!accrued) throw new Error('Workflow usage billing ledger is missing')
        billing.accountedCost = (billing.accountedCost ?? 0) + costDelta
        billing.accountedTokens = (billing.accountedTokens ?? 0) + tokenDelta
        billing.counted = true
        receipt = { context, workflowId: row.workflowId, costDelta }
      }
      await tx
        .update(workflowExecutionLogs)
        .set({
          cost,
          executionData: {
            ...data,
            billing: { ...billing, quote },
            tokenBreakdown: cost.tokens,
            models: cost.models,
          },
        })
        .where(eq(workflowExecutionLogs.id, row.id))
      return receipt
    }
    if (transaction) return settle(transaction)
    const receipt = await db.transaction(settle)
    await this.notifyWorkflowUsage(receipt)
    return receipt
  }

  async notifyWorkflowUsage(receipt?: UsageReceipt): Promise<void> {
    if (!receipt || receipt.costDelta <= 0) return
    const { context, workflowId, costDelta } = receipt
    try {
      await checkAndBillOverageThreshold({
        userId: context.actorUserId ?? context.billingUserId,
        workspaceId: context.workspaceId,
        workflowId,
      })
    } catch (error) {
      logger.warn('Workflow overage threshold billing failed', { error })
    }
    try {
      const [billingUser] = await db
        .select({ email: userTable.email, name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, context.billingUserId))
        .limit(1)
      let currentUsageAfter: number
      let limit: number
      if (context.scopeType === 'organization') {
        const [ledger, orgRows] = await Promise.all([
          getOrganizationBillingLedger(context.scopeId),
          db
            .select({ orgUsageLimit: organization.orgUsageLimit })
            .from(organization)
            .where(eq(organization.id, context.scopeId))
            .limit(1),
        ])
        const { getBillingTierPricing } = await import('@/lib/billing/core/billing')
        const { usageAllowance } = getBillingTierPricing(context.subscription)
        limit = Math.max(Number(orgRows[0]?.orgUsageLimit ?? 0), usageAllowance)
        currentUsageAfter = ledger?.currentPeriodCost ?? 0
      } else if (
        context.scopeType === 'organization_member' &&
        context.billingOwner.type === 'organization'
      ) {
        const ledger = await getOrganizationMemberBillingLedger(
          context.billingOwner.organizationId,
          context.billingUserId
        )
        limit = getTierUsageAllowanceUsd(context.subscription?.tier ?? context.tier)
        currentUsageAfter = ledger?.currentPeriodCost ?? 0
      } else {
        const status = await checkUsageStatus(context.billingUserId)
        limit = status.usageData.limit
        currentUsageAfter = status.usageData.currentUsage
      }
      if (context.scopeType !== 'organization' && !billingUser?.email) return
      await maybeSendUsageThresholdEmail({
        ...(context.scopeType === 'organization'
          ? { scope: 'organization' as const, organizationId: context.scopeId }
          : {
              scope: 'user' as const,
              userId: context.billingUserId,
              userEmail: billingUser!.email,
              userName: billingUser!.name || undefined,
            }),
        planName: getTierDisplayName(context.tier),
        isFreeTier: context.scopeType !== 'organization' && isFreeBillingTier(context.tier),
        percentBefore:
          limit > 0 ? Math.min(100, (Math.max(0, currentUsageAfter - costDelta) / limit) * 100) : 0,
        percentAfter: limit > 0 ? Math.min(100, (currentUsageAfter / limit) * 100) : 0,
        currentUsageAfter,
        limit,
      })
    } catch (error) {
      logger.warn('Usage threshold notification check failed (non-fatal)', { error })
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
