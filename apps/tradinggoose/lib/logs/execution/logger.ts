import {
  acceptModelStep,
  type FinancialBinding,
  type FinancialTransaction,
} from '@tradinggoose/billing'
import type { DecimalAmount } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { admitFinancialModelStep, createFinancialInvocation } from '@/lib/billing/native-finance'
import { createLogger } from '@/lib/logs/console/logger'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { verifyWorkflowFinancialAcceptance } from '@/lib/logs/execution/financial-acceptance'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import type {
  BlockOutputData,
  CostMetadata,
  ExecutionEnvironment,
  ExecutionTrigger,
  TraceSpan,
  WorkflowExecutionLog,
  WorkflowExecutionSnapshot,
  WorkflowState,
} from '@/lib/logs/types'
import { writeFunctionalPayload } from '@/lib/mastra/workflow-history'
import {
  assertRetainedLogAccess,
  FUNCTIONAL_OUTPUT_REFERENCE,
  hydrateExecutionPayload,
  projectFunctionalBlocks,
} from '@/lib/workflow-archive/functional'

const logger = createLogger('ExecutionLogger')

type ExecutionBilling = { binding?: FinancialBinding; billable?: boolean }
type UsageReceipt = { binding: FinancialBinding; appliedUsd?: DecimalAmount }

function executionCost(
  traceSpans: TraceSpan[],
  unavailable = false
): CostMetadata & { status: NonNullable<CostMetadata['status']> } {
  if (unavailable) return { status: 'unavailable', tokens: {}, models: {} }
  const summary = calculateCostSummary(traceSpans)
  return {
    total: summary.totalCost,
    availableTotal: summary.availableTotal,
    status: summary.status,
    estimated: summary.estimated,
    toolCost: summary.toolCost,
    unavailableComponents: summary.unavailableComponents,
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
    billable?: boolean
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

    const binding = await createFinancialInvocation({
      actorUserId: environment.userId,
      workspaceId: environment.workspaceId,
      workflowId,
      runId: executionId,
      purpose: 'workflow-execution',
      operationKey: executionId,
      billable: params.billable ?? true,
    })
    await admitFinancialModelStep(binding, { stepNumber: 0, retryCount: 0 })
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
            billing: { binding, billable: params.billable ?? true },
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
            billing: { binding, billable: params.billable ?? true },
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
    let cost = executionCost(traceSpans, Boolean(existingLog.endedAt))
    const executionFiles = this.extractFilesFromExecution(traceSpans, finalOutput, workflowInput)
    let deliveredOutput = finalOutput
    let deliveredSpans = traceSpans
    let completedExecutionData: Record<string, unknown> = {}
    if (existingLog.endedAt) {
      // Retrying terminal publication/finance reuses canonical paid work; it never rewrites or replays it.
      const scope = { workspaceId, executionId, logId: workflowLogId }
      const retained = await hydrateExecutionPayload(
        { ...existingLog, ...scope, executionData: existingData },
        () => assertRetainedLogAccess(scope)
      )
      deliveredOutput = retained.executionData.finalOutput
      deliveredSpans = retained.executionData.traceSpans ?? []
    } else {
      const blocks = projectFunctionalBlocks(traceSpans)
      const functionalPayload = await writeFunctionalPayload(
        {
          workspaceId,
          executionId,
          logId: workflowLogId,
          blockId: '__execution__',
          runId: 'completion',
          ...(readExecutionActorUserId(existingData)
            ? { actorUserId: readExecutionActorUserId(existingData)! }
            : {}),
        },
        { blocks, output: finalOutput }
      )
      const nativePayloads = {
        ...(existingData.nativePayloads ?? {}),
        ...(existingData.functionalPayload
          ? {
              [`${existingData.functionalPayload.blockId}:${existingData.functionalPayload.runId}`]:
                existingData.functionalPayload,
            }
          : {}),
        ...Object.fromEntries(
          blocks.flatMap((block) =>
            block.nativePayload
              ? [
                  [
                    `${block.nativePayload.blockId}:${block.nativePayload.runId}`,
                    block.nativePayload,
                  ],
                ]
              : []
          )
        ),
        [`${functionalPayload.blockId}:${functionalPayload.runId}`]: functionalPayload,
      }
      completedExecutionData = {
        ...(variables ? { environment: { ...existingData.environment, variables } } : {}),
        functionalPayload,
        nativePayloads,
        finalOutput: FUNCTIONAL_OUTPUT_REFERENCE,
        ...(hasResponseBlock ? { hasResponseBlock: true } : {}),
        ...(failureReason ? { errorMessage: failureReason } : {}),
      }
    }

    // Terminal state survives a pricing/ledger outage; settlement retries only accounting.
    const completedRows = await db
      .update(workflowExecutionLogs)
      .set({
        level: success ? 'info' : 'error',
        endedAt: new Date(endedAt),
        totalDurationMs,
        files: executionFiles.length > 0 ? executionFiles : null,
        executionData: sql`(coalesce(${workflowExecutionLogs.executionData}, '{}'::jsonb) || ${JSON.stringify(completedExecutionData)}::jsonb || jsonb_build_object('billing', coalesce(${workflowExecutionLogs.executionData}->'billing', '{}'::jsonb) || ${JSON.stringify({ billable })}::jsonb)) - 'checkpoint' - 'pause' - 'traceSpans' - 'tokenBreakdown' - 'models'`,
        cost: null,
      })
      .where(and(workflowLogWhere, isNull(workflowExecutionLogs.endedAt)))
      .returning()

    await this.settleWorkflowExecutionUsage(executionId)
    const [completedRow] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(workflowLogWhere)
      .limit(1)
    if (!completedRow?.endedAt)
      throw new Error(`Workflow log not found for execution ${executionId}`)

    if (!completedRows.length) {
      // A competing completion owns the retained payload, status and delivery.
      if (
        !completedRow.executionData ||
        typeof completedRow.executionData !== 'object' ||
        Array.isArray(completedRow.executionData)
      )
        throw new Error('Completed workflow payload is unavailable')
      const scope = { workspaceId, executionId, logId: workflowLogId }
      const retained = await hydrateExecutionPayload(
        {
          ...completedRow,
          ...scope,
          executionData: completedRow.executionData as Record<string, any>,
        },
        () => assertRetainedLogAccess(scope)
      )
      deliveredOutput = retained.executionData.finalOutput
      deliveredSpans = retained.executionData.traceSpans ?? []
      cost = executionCost(deliveredSpans, true)
    }

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
      executionData: {
        ...(completedRow.executionData as WorkflowExecutionLog['executionData']),
        finalOutput: deliveredOutput,
        traceSpans: deliveredSpans,
      },
      cost,
      createdAt: completedRow.createdAt.toISOString(),
    }
    await verifyWorkflowFinancialAcceptance(completedRow)
    await emitWorkflowExecutionCompleted(completedLog)
    return completedLog
  }

  /** Original pinned fixed/business charge posts once; model results settle at their own gates. */
  async settleWorkflowExecutionUsage(
    executionId: string,
    transaction?: FinancialTransaction
  ): Promise<UsageReceipt | undefined> {
    const settle = async (tx: FinancialTransaction): Promise<UsageReceipt> => {
      const [row] = await tx
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .limit(1)
      if (!row) throw new Error(`Workflow log not found for execution ${executionId}`)
      const data = row.executionData as Record<string, any>
      const binding = (data.billing as ExecutionBilling | undefined)?.binding
      if (!binding || binding.runId !== executionId || binding.workspaceId !== row.workspaceId)
        throw new Error('Original workflow financial binding is missing')
      const accepted = await acceptModelStep(
        tx,
        binding,
        { stepNumber: 0, retryCount: 0 },
        {
          executionTrigger: row.trigger as ExecutionTrigger['type'],
        }
      )
      return { binding, appliedUsd: accepted.appliedUsd }
    }
    return transaction ? settle(transaction) : db.transaction(settle)
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
