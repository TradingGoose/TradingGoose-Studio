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
  type WorkflowExecutionBlueprint,
} from '@/lib/workflows/execution-runner'
import { processWorkflowInputFormatFiles } from '@/lib/workflows/input-format-files'
import { getTrigger } from '@/triggers'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import { executeWorkflowJob, type WorkflowExecutionAttemptOptions } from './workflow-execution'

const logger = createLogger('TriggerWebhookExecution')

async function processTriggerFileOutputs(
  input: any,
  triggerOutputs: Record<string, any>,
  context: {
    workspaceId: string
    workflowId: string
    executionId: string
    requestId: string
  },
  signal?: AbortSignal
): Promise<any> {
  signal?.throwIfAborted()
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed: any = Array.isArray(input) ? [] : {}

  for (const [key, value] of Object.entries(input)) {
    signal?.throwIfAborted()
    const outputDef = triggerOutputs[key]
    const val: any = value

    if (outputDef?.type === 'file[]' && Array.isArray(val)) {
      processed[key] = await WebhookAttachmentProcessor.processAttachments(
        val as any,
        context,
        signal
      )
    } else if (outputDef?.type === 'file' && val) {
      const [processedFile] = await WebhookAttachmentProcessor.processAttachments(
        [val as any],
        context,
        signal
      )
      processed[key] = processedFile
    } else if (outputDef && typeof outputDef === 'object' && !outputDef.type) {
      processed[key] = await processTriggerFileOutputs(val, outputDef, context, signal)
    } else {
      processed[key] = val
    }
    signal?.throwIfAborted()
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

async function logWebhookFailure(params: {
  payload: WebhookExecutionPayload
  executionId: string
  requestId: string
  workspaceId: string
  workflowState: WorkflowExecutionBlueprint['workflowData']
  triggerData: Record<string, unknown>
  error: Error
  attemptStartedAt?: string
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
    startedAt: params.attemptStartedAt,
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

export async function executeWebhookJob(
  payload: WebhookExecutionPayload,
  options: WorkflowExecutionAttemptOptions
) {
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
  let airtableContinuation: NonNullable<AirtablePollResult['continuation']> | null = null

  try {
    const [completedExecution] = await db
      .select({
        endedAt: workflowExecutionLogs.endedAt,
        level: workflowExecutionLogs.level,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    let result: Awaited<ReturnType<typeof executeWorkflowJob>>
    if (completedExecution?.endedAt) {
      const success = completedExecution.level === 'info'
      executionLogOwned = true
      workspaceId = options.fallbackWorkspaceId
      airtableContinuation =
        success && payload.provider === 'airtable' ? getAirtablePollContinuation(payload) : null
      result = {
        success,
        workflowId: payload.workflowId,
        executionId,
        output: {},
        executedAt: completedExecution.endedAt.toISOString(),
      }
    } else {
      result = await executeWorkflowJob(
        {
          workflowId: payload.workflowId,
          userId: payload.userId,
          workspaceId: options.fallbackWorkspaceId,
          executionId,
          triggerType: 'webhook',
          triggerBlockId: payload.blockId,
          executionTarget: 'deployed',
          triggerData,
        },
        options,
        async () => {
          try {
            options.timeBudget.signal.throwIfAborted()
            const blueprint = await loadWorkflowExecutionBlueprint({
              workflowId: payload.workflowId,
              executionTarget,
            })
            options.timeBudget.signal.throwIfAborted()
            const scopedWorkspaceId = blueprint.workflowContext.workspaceId
            if (!scopedWorkspaceId) {
              throw new Error(`Workflow ${payload.workflowId} is missing workspace scope`)
            }

            workspaceId = scopedWorkspaceId
            workflowState = blueprint.workflowData

            const blocks = blueprint.workflowData.blocks
            options.timeBudget.signal.throwIfAborted()
            const webhookRows = await db
              .select()
              .from(webhook)
              .where(eq(webhook.id, payload.webhookId))
              .limit(1)
            options.timeBudget.signal.throwIfAborted()
            const webhookRecord =
              webhookRows[0] ||
              ({
                id: payload.webhookId,
                provider: payload.provider,
                blockId: payload.blockId,
                providerConfig: {},
              } as const)
            if (payload.provider === 'airtable' && !webhookRows[0]) {
              throw new Error(`Webhook record not found: ${payload.webhookId}`)
            }

            const formattedInput = await formatWebhookInput(
              webhookRecord,
              { id: payload.workflowId, userId: payload.userId, workspaceId: scopedWorkspaceId },
              payload.body,
              { headers: new Map(Object.entries(payload.headers ?? {})) } as any,
              requestId,
              executionId,
              options.timeBudget.signal
            )
            options.timeBudget.signal.throwIfAborted()
            const airtablePoll =
              payload.provider === 'airtable' ? (formattedInput as AirtablePollResult) : null
            const input = airtablePoll ? airtablePoll.input : formattedInput
            airtableContinuation = airtablePoll?.continuation ?? null

            if (!input && (payload.provider === 'whatsapp' || payload.provider === 'airtable')) {
              options.timeBudget.signal.throwIfAborted()
              const message =
                payload.provider === 'airtable'
                  ? 'No Airtable changes to process'
                  : 'No messages in WhatsApp payload'
              logger.info(`[${requestId}] ${message}, skipping execution`)
              return {
                kind: 'execute' as const,
                payload: {
                  workflowId: payload.workflowId,
                  userId: payload.userId,
                  workspaceId: scopedWorkspaceId,
                  executionId,
                  triggerType: 'webhook' as const,
                  input: {},
                  triggerBlockId: payload.blockId,
                  executionTarget: 'deployed' as const,
                  triggerData,
                },
                blueprint,
                immediateResult: { success: true, output: { message }, logs: [] },
              }
            }

            if (input && blocks[payload.blockId]) {
              const triggerId = resolveTriggerIdForBlock(blocks[payload.blockId])
              const triggerConfig = typeof triggerId === 'string' ? getTrigger(triggerId) : null
              if (triggerConfig?.outputs) {
                logger.debug(`[${requestId}] Processing trigger ${triggerId} file outputs`)
                Object.assign(
                  input,
                  await processTriggerFileOutputs(
                    input,
                    triggerConfig.outputs,
                    {
                      workspaceId: scopedWorkspaceId,
                      workflowId: payload.workflowId,
                      executionId,
                      requestId,
                    },
                    options.timeBudget.signal
                  )
                )
                options.timeBudget.signal.throwIfAborted()
              }
            }

            if (
              input &&
              typeof input === 'object' &&
              !Array.isArray(input) &&
              payload.provider === 'generic' &&
              blocks[payload.blockId]
            ) {
              Object.assign(
                input,
                await processWorkflowInputFormatFiles({
                  input,
                  blocks,
                  blockId: payload.blockId,
                  executionContext: {
                    workspaceId: scopedWorkspaceId,
                    workflowId: payload.workflowId,
                    executionId,
                  },
                  requestId,
                  signal: options.timeBudget.signal,
                })
              )
              options.timeBudget.signal.throwIfAborted()
            }

            options.timeBudget.signal.throwIfAborted()
            return {
              kind: 'execute' as const,
              payload: {
                workflowId: payload.workflowId,
                userId: payload.userId,
                workspaceId: scopedWorkspaceId,
                executionId,
                triggerType: 'webhook' as const,
                input: input || {},
                triggerBlockId: payload.blockId,
                executionTarget: 'deployed' as const,
                triggerData,
              },
              blueprint,
            }
          } catch (error) {
            if (options.timeBudget.signal.aborted) return { kind: 'ignore' as const }
            throw error
          }
        }
      )
    }
    if (!result) throw new Error('Webhook preparation completed without an execution result')
    executionLogOwned = true

    logger.info(`[${requestId}] Webhook execution completed`, {
      success: result.success,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    if (result.success && airtableContinuation && workspaceId) {
      await enqueuePendingExecution({
        executionType: 'webhook',
        pendingExecutionId: getAirtableContinuationExecutionId(
          payload.webhookId,
          airtableContinuation
        ),
        workflowId: payload.workflowId,
        workspaceId,
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
          attemptStartedAt: options.attemptStartedAt,
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
