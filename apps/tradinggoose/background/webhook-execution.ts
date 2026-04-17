import { db } from '@tradinggoose/db'
import { webhook } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { processExecutionFiles } from '@/lib/execution/files'
import { toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'
import {
  fetchAndProcessAirtablePayloads,
  formatWebhookInput,
} from '@/lib/webhooks/utils'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution,
} from '@/lib/workflows/execution-runner'
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
  },
  path = '',
): Promise<any> {
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed: any = Array.isArray(input) ? [] : {}

  for (const [key, value] of Object.entries(input)) {
    const currentPath = path ? `${path}.${key}` : key
    const outputDef = triggerOutputs[key]
    const val: any = value

    if (outputDef?.type === 'file[]' && Array.isArray(val)) {
      try {
        processed[key] = await WebhookAttachmentProcessor.processAttachments(
          val as any,
          context,
        )
      } catch {
        processed[key] = []
      }
    } else if (outputDef?.type === 'file' && val) {
      try {
        const [processedFile] =
          await WebhookAttachmentProcessor.processAttachments(
            [val as any],
            context,
          )
        processed[key] = processedFile
      } catch (error) {
        logger.error(
          `[${context.requestId}] Error processing ${currentPath}:`,
          error,
        )
        processed[key] = val
      }
    } else if (outputDef && typeof outputDef === 'object' && !outputDef.type) {
      processed[key] = await processTriggerFileOutputs(
        val,
        outputDef,
        context,
        currentPath,
      )
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
  blockId?: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function isWebhookExecutionPayload(
  value: unknown,
): value is WebhookExecutionPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.webhookId === 'string' &&
    typeof candidate.workflowId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.provider === 'string'
  )
}

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const buildIndicatorTriggerData = (
  payload: WebhookExecutionPayload,
): Record<string, unknown> | null => {
  if (payload.provider !== 'indicator') return null
  if (!isRecord(payload.body)) {
    return { source: 'indicator_trigger' }
  }

  const monitorRaw = payload.body.monitor
  if (!isRecord(monitorRaw)) {
    return { source: 'indicator_trigger' }
  }

  const listing = toListingValueObject(monitorRaw.listing as any)
  const monitor = {
    id: toTrimmedString(monitorRaw.id),
    workflowId: toTrimmedString(monitorRaw.workflowId),
    blockId: toTrimmedString(monitorRaw.blockId),
    providerId: toTrimmedString(monitorRaw.providerId),
    interval: toTrimmedString(monitorRaw.interval),
    indicatorId: toTrimmedString(monitorRaw.indicatorId),
  }

  const monitorMetadata = Object.fromEntries(
    Object.entries(monitor).filter(
      ([, value]) => typeof value === 'string' && value.length > 0,
    ),
  )

  return {
    source: 'indicator_trigger',
    monitor: listing
      ? {
          ...monitorMetadata,
          listing,
        }
      : monitorMetadata,
  }
}

async function completeSkippedWebhookExecution(params: {
  payload: WebhookExecutionPayload
  executionId: string
  requestId: string
  workspaceId?: string | null
  triggerData: Record<string, unknown>
  message: string
}) {
  const loggingSession = new LoggingSession(
    params.payload.workflowId,
    params.executionId,
    'webhook',
    params.requestId,
  )

  await loggingSession.safeStart({
    userId: params.payload.userId,
    workspaceId: params.workspaceId || '',
    variables: {},
    triggerData: params.triggerData,
  })

  await loggingSession.safeComplete({
    endedAt: new Date().toISOString(),
    totalDurationMs: 0,
    finalOutput: { message: params.message },
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
  workspaceId?: string | null
  triggerData: Record<string, unknown>
  error: Error
}) {
  try {
    const loggingSession = new LoggingSession(
      params.payload.workflowId,
      params.executionId,
      'webhook',
      params.requestId,
    )

    await loggingSession.safeStart({
      userId: params.payload.userId,
      workspaceId: params.workspaceId || '',
      variables: {},
      triggerData: params.triggerData,
    })

    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: 0,
      error: {
        message: params.error.message || 'Webhook execution failed',
        stackTrace: params.error.stack,
      },
      traceSpans: [],
    })
  } catch (loggingError) {
    logger.error(
      `[${params.requestId}] Failed to complete webhook failure logging`,
      loggingError,
    )
  }
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

  const indicatorTriggerData = buildIndicatorTriggerData(payload)
  const triggerData = {
    isTest: payload.testMode === true,
    executionTarget,
    ...(indicatorTriggerData ?? {}),
  }

  let runnerInvoked = false
  let workspaceId: string | null | undefined

  try {
    const blueprint = await loadWorkflowExecutionBlueprint({
      workflowId: payload.workflowId,
      executionTarget,
    })
    const blocks = blueprint.workflowData.blocks
    workspaceId = blueprint.workflowContext.workspaceId

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
    }

    if (payload.provider === 'airtable') {
      if (!webhookRows[0]) {
        throw new Error(`Webhook record not found: ${payload.webhookId}`)
      }

      logger.info(
        `[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`,
      )

      const airtableInput = await fetchAndProcessAirtablePayloads(
        {
          id: payload.webhookId,
          provider: payload.provider,
          providerConfig: webhookRows[0].providerConfig,
        },
        workflowRef,
        requestId,
      )

      if (!airtableInput) {
        logger.info(`[${requestId}] No Airtable changes to process`)
        return completeSkippedWebhookExecution({
          payload,
          executionId,
          requestId,
          workspaceId,
          triggerData,
          message: 'No Airtable changes to process',
        })
      }

      runnerInvoked = true
      const { result } = await runPreparedWorkflowExecution({
        blueprint,
        actorUserId: payload.userId,
        requestId,
        executionId,
        triggerType: 'webhook',
        workflowInput: airtableInput,
        start: {
          kind: 'block',
          blockId: payload.blockId,
        },
        triggerData,
      })

      logger.info(`[${requestId}] Airtable webhook execution completed`, {
        success: result.success,
        workflowId: payload.workflowId,
      })

      return {
        success: result.success,
        workflowId: payload.workflowId,
        executionId,
        output: result.output,
        executedAt: new Date().toISOString(),
        provider: payload.provider,
      }
    }

    const mockRequest = {
      headers: new Map(Object.entries(payload.headers)),
    } as any

    const input = await formatWebhookInput(
      webhookRecord,
      workflowRef,
      payload.body,
      mockRequest,
    )

    if (!input && payload.provider === 'whatsapp') {
      logger.info(
        `[${requestId}] No messages in WhatsApp payload, skipping execution`,
      )
      return completeSkippedWebhookExecution({
        payload,
        executionId,
        requestId,
        workspaceId,
        triggerData,
        message: 'No messages in WhatsApp payload',
      })
    }

    if (input && payload.blockId && blocks[payload.blockId]) {
      try {
        const triggerBlock = blocks[payload.blockId]
        const triggerId = resolveTriggerIdForBlock(triggerBlock)

        if (triggerId && typeof triggerId === 'string') {
          const triggerConfig = getTrigger(triggerId)

          if (triggerConfig?.outputs) {
            logger.debug(
              `[${requestId}] Processing trigger ${triggerId} file outputs`,
            )
            const processedInput = await processTriggerFileOutputs(
              input,
              triggerConfig.outputs,
              {
                workspaceId: workspaceId || '',
                workflowId: payload.workflowId,
                executionId,
                requestId,
              },
            )
            Object.assign(input, processedInput)
          }
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Error processing trigger file outputs:`,
          error,
        )
      }
    }

    if (
      input &&
      payload.provider === 'generic' &&
      payload.blockId &&
      blocks[payload.blockId]
    ) {
      try {
        const triggerBlock = blocks[payload.blockId]

        if (triggerBlock?.subBlocks?.inputFormat?.value) {
          const inputFormat = triggerBlock.subBlocks.inputFormat
            .value as Array<{
            name: string
            type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
          }>
          const fileFields = inputFormat.filter(
            (field) => field.type === 'files',
          )

          if (
            fileFields.length > 0 &&
            typeof input === 'object' &&
            input !== null
          ) {
            const executionContext = {
              workspaceId: workspaceId || '',
              workflowId: payload.workflowId,
              executionId,
            }

            for (const fileField of fileFields) {
              const fieldValue = input[fileField.name]

              if (fieldValue && typeof fieldValue === 'object') {
                const uploadedFiles = await processExecutionFiles(
                  fieldValue,
                  executionContext,
                  requestId,
                )

                if (uploadedFiles.length > 0) {
                  input[fileField.name] = uploadedFiles
                  logger.info(
                    `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`,
                  )
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Error processing generic webhook files:`,
          error,
        )
      }
    }

    runnerInvoked = true
    const { result } = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: payload.userId,
      requestId,
      executionId,
      triggerType: 'webhook',
      workflowInput: input || {},
      start: {
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

    if (!runnerInvoked && error instanceof Error) {
      await logWebhookFailure({
        payload,
        executionId,
        requestId,
        workspaceId,
        triggerData,
        error,
      })
    }

    throw error
  }
}
