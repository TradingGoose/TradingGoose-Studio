import { db } from '@tradinggoose/db'
import { webhook, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { schedules } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { enqueuePendingExecution } from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'
import {
  type AirtablePollResult,
  AirtableStageIntegrityError,
  formatWebhookInput,
  getAirtableContinuationExecutionId,
  getAirtablePollContinuation,
} from '@/lib/webhooks/utils'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution,
  type WorkflowExecutionBlueprint,
} from '@/lib/workflows/execution-runner'
import { processWorkflowInputFormatFiles } from '@/lib/workflows/input-format-files'
import { getTrigger } from '@/triggers'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'

const logger = createLogger('TriggerWebhookExecution')

async function processTriggerFileOutputs(
  input: any,
  triggerOutputs: Record<string, any>,
  context: {
    workspaceId: string
    workflowId: string
    executionId: string
    requestId: string
  }
): Promise<any> {
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed: any = Array.isArray(input) ? [] : {}

  for (const [key, value] of Object.entries(input)) {
    const outputDef = triggerOutputs[key]
    const val: any = value

    if (outputDef?.type === 'file[]' && Array.isArray(val)) {
      processed[key] = await WebhookAttachmentProcessor.processAttachments(val as any, context)
    } else if (outputDef?.type === 'file' && val) {
      const [processedFile] = await WebhookAttachmentProcessor.processAttachments(
        [val as any],
        context
      )
      processed[key] = processedFile
    } else if (outputDef && typeof outputDef === 'object' && !outputDef.type) {
      processed[key] = await processTriggerFileOutputs(val, outputDef, context)
    } else {
      processed[key] = val
    }
  }

  return processed
}

export type WebhookExecutionPayload = {
  webhookId: string
  workflowId: string
  userId: string
  executionId?: string
  provider: string
  body: any
  headers: Record<string, string>
  blockId: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
}

export function isWebhookExecutionPayload(value: unknown): value is WebhookExecutionPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.webhookId === 'string' &&
    typeof candidate.workflowId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.provider === 'string' &&
    typeof candidate.blockId === 'string'
  )
}

async function completeSkippedWebhookExecution(params: {
  payload: WebhookExecutionPayload
  executionId: string
  requestId: string
  workspaceId: string
  workflowState: WorkflowExecutionBlueprint['workflowData']
  triggerData: Record<string, unknown>
  message: string
}) {
  const loggingSession = new LoggingSession(
    params.payload.workflowId,
    params.executionId,
    'webhook',
    params.requestId
  )

  await loggingSession.start({
    userId: params.payload.userId,
    workspaceId: params.workspaceId,
    workflowState: params.workflowState,
    triggerData: params.triggerData,
  })

  await loggingSession.complete({
    endedAt: new Date().toISOString(),
    totalDurationMs: 0,
    finalOutput: { message: params.message },
    success: true,
    traceSpans: [],
  })

  return {
    success: true,
    workflowId: params.payload.workflowId,
    executionId: params.executionId,
    output: { message: params.message },
    executedAt: new Date().toISOString(),
    provider: params.payload.provider,
  }
}

async function logWebhookFailure(params: {
  payload: WebhookExecutionPayload
  executionId: string
  requestId: string
  workspaceId: string
  workflowState: WorkflowExecutionBlueprint['workflowData']
  triggerData: Record<string, unknown>
  error: Error
}) {
  const loggingSession = new LoggingSession(
    params.payload.workflowId,
    params.executionId,
    'webhook',
    params.requestId
  )

  await loggingSession.start({
    userId: params.payload.userId,
    workspaceId: params.workspaceId,
    workflowState: params.workflowState,
    triggerData: params.triggerData,
  })

  await loggingSession.completeWithError({
    endedAt: new Date().toISOString(),
    totalDurationMs: 0,
    error: {
      message: params.error.message || 'Webhook execution failed',
      stackTrace: params.error.stack,
    },
    traceSpans: [],
  })
}

export async function executeWebhookJob(payload: WebhookExecutionPayload) {
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  const executionTarget = payload.executionTarget ?? 'deployed'

  logger.info(`[${requestId}] Starting webhook execution`, {
    webhookId: payload.webhookId,
    workflowId: payload.workflowId,
    provider: payload.provider,
    userId: payload.userId,
    executionId,
  })

  const triggerData = {
    isTest: payload.testMode === true,
    executionTarget,
  }

  let executionLogOwned = false
  let workspaceId: string | null = null
  let workflowState: WorkflowExecutionBlueprint['workflowData'] | null = null

  try {
    const blueprint = await loadWorkflowExecutionBlueprint({
      workflowId: payload.workflowId,
      executionTarget,
    })
    const scopedWorkspaceId = blueprint.workflowContext.workspaceId
    if (!scopedWorkspaceId) {
      throw new Error(`Workflow ${payload.workflowId} is missing workspace scope`)
    }

    workspaceId = scopedWorkspaceId
    workflowState = blueprint.workflowData

    const enqueueAirtableContinuation = (
      continuation: NonNullable<AirtablePollResult['continuation']>
    ) =>
      enqueuePendingExecution({
        executionType: 'webhook',
        pendingExecutionId: getAirtableContinuationExecutionId(payload.webhookId, continuation),
        workflowId: payload.workflowId,
        workspaceId: scopedWorkspaceId,
        userId: payload.userId,
        source: 'webhook:airtable',
        requestId,
        payload: {
          webhookId: payload.webhookId,
          workflowId: payload.workflowId,
          userId: payload.userId,
          provider: payload.provider,
          blockId: payload.blockId,
          testMode: payload.testMode,
          executionTarget: payload.executionTarget,
        },
      })

    const [completedExecution] = await db
      .select({
        endedAt: workflowExecutionLogs.endedAt,
        level: workflowExecutionLogs.level,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (completedExecution?.endedAt) {
      executionLogOwned = true
      const success = completedExecution.level === 'info'
      const continuation =
        success && payload.provider === 'airtable' ? getAirtablePollContinuation(payload) : null
      if (continuation) {
        await enqueueAirtableContinuation(continuation)
      }
      return {
        success,
        workflowId: payload.workflowId,
        executionId,
        output: {},
        executedAt: completedExecution.endedAt.toISOString(),
        provider: payload.provider,
      }
    }

    const blocks = blueprint.workflowData.blocks

    const webhookRows = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, payload.webhookId))
      .limit(1)

    const webhookRecord =
      webhookRows[0] ||
      ({
        id: payload.webhookId,
        provider: payload.provider,
        blockId: payload.blockId,
        providerConfig: {},
      } as const)

    const workflowRef = {
      id: payload.workflowId,
      userId: payload.userId,
      workspaceId: scopedWorkspaceId,
    }

    if (payload.provider === 'airtable' && !webhookRows[0]) {
      throw new Error(`Webhook record not found: ${payload.webhookId}`)
    }

    const mockRequest = {
      headers: new Map(Object.entries(payload.headers ?? {})),
    } as any

    const formattedInput = await formatWebhookInput(
      webhookRecord,
      workflowRef,
      payload.body,
      mockRequest,
      requestId,
      executionId
    )
    const airtablePoll =
      payload.provider === 'airtable' ? (formattedInput as AirtablePollResult) : null
    const input = airtablePoll ? airtablePoll.input : formattedInput

    if (!input && (payload.provider === 'whatsapp' || payload.provider === 'airtable')) {
      const message =
        payload.provider === 'airtable'
          ? 'No Airtable changes to process'
          : 'No messages in WhatsApp payload'
      logger.info(`[${requestId}] ${message}, skipping execution`)
      const skippedExecution = await completeSkippedWebhookExecution({
        payload,
        executionId,
        requestId,
        workspaceId: scopedWorkspaceId,
        workflowState: blueprint.workflowData,
        triggerData,
        message,
      })
      executionLogOwned = true
      if (airtablePoll?.continuation) {
        await enqueueAirtableContinuation(airtablePoll.continuation)
      }
      return skippedExecution
    }

    if (input && payload.blockId && blocks[payload.blockId]) {
      const triggerBlock = blocks[payload.blockId]
      const triggerId = resolveTriggerIdForBlock(triggerBlock)

      if (triggerId && typeof triggerId === 'string') {
        const triggerConfig = getTrigger(triggerId)

        if (triggerConfig?.outputs) {
          logger.debug(`[${requestId}] Processing trigger ${triggerId} file outputs`)
          const processedInput = await processTriggerFileOutputs(input, triggerConfig.outputs, {
            workspaceId: scopedWorkspaceId,
            workflowId: payload.workflowId,
            executionId,
            requestId,
          })
          Object.assign(input, processedInput)
        }
      }
    }

    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      payload.provider === 'generic' &&
      payload.blockId &&
      blocks[payload.blockId]
    ) {
      const processedInput = await processWorkflowInputFormatFiles({
        input,
        blocks,
        blockId: payload.blockId,
        executionContext: {
          workspaceId: scopedWorkspaceId,
          workflowId: payload.workflowId,
          executionId,
        },
        requestId,
      })
      Object.assign(input, processedInput)
    }

    executionLogOwned = true
    const { result } = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: payload.userId,
      requestId,
      executionId,
      triggerType: 'webhook',
      workflowInput: input || {},
      triggerTarget: {
        kind: 'block',
        blockId: payload.blockId,
      },
      triggerData,
    })

    logger.info(`[${requestId}] Webhook execution completed`, {
      success: result.success,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    if (result.success && airtablePoll?.continuation) {
      await enqueueAirtableContinuation(airtablePoll.continuation)
    }

    return {
      success: result.success,
      workflowId: payload.workflowId,
      executionId,
      output: result.output,
      executedAt: new Date().toISOString(),
      provider: payload.provider,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Webhook execution failed`, {
      error: error.message,
      stack: error.stack,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    if (
      !executionLogOwned &&
      !(error instanceof AirtableStageIntegrityError) &&
      error instanceof Error &&
      workspaceId &&
      workflowState
    ) {
      try {
        await logWebhookFailure({
          payload,
          executionId,
          requestId,
          workspaceId,
          workflowState,
          triggerData,
          error,
        })
      } catch (loggingError) {
        logger.error(`[${requestId}] Failed to complete webhook failure logging`, loggingError)
        throw error
      }
      return {
        success: false,
        workflowId: payload.workflowId,
        executionId,
        output: {},
        executedAt: new Date().toISOString(),
        provider: payload.provider,
      }
    }

    throw error
  }
}

export const airtableWebhookCleanupSweep = schedules.task({
  id: 'airtable-webhook-cleanup-sweep',
  cron: '*/5 * * * *',
  retry: {
    maxAttempts: 3,
    factor: 3,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 900_000,
    randomize: true,
  },
  run: async () => {
    const { sweepAirtableWebhookCleanup } = await import('@/lib/webhooks/webhook-helpers')
    await sweepAirtableWebhookCleanup(`airtable-cleanup-${Date.now()}`)
  },
})
