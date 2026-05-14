import { db } from '@tradinggoose/db'
import { webhook } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { withExecutionConcurrencyLimit } from '@/lib/execution/execution-concurrency-limit'
import { toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils'
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
  blockId?: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function isWebhookExecutionPayload(value: unknown): value is WebhookExecutionPayload {
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
  payload: WebhookExecutionPayload
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
    Object.entries(monitor).filter(([, value]) => typeof value === 'string' && value.length > 0)
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
    variables: {},
    triggerData: params.triggerData,
  })

  await loggingSession.complete({
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
  workspaceId: string
  workflowState: WorkflowExecutionBlueprint['workflowData']
  triggerData: Record<string, unknown>
  error: Error
}) {
  try {
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
      variables: {},
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
  } catch (loggingError) {
    logger.error(`[${params.requestId}] Failed to complete webhook failure logging`, loggingError)
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

    return await withExecutionConcurrencyLimit({
      userId: payload.userId,
      workflowId: payload.workflowId,
      workspaceId: scopedWorkspaceId,
      task: async () => {
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

        if (payload.provider === 'airtable') {
          if (!webhookRows[0]) {
            throw new Error(`Webhook record not found: ${payload.webhookId}`)
          }

          logger.info(
            `[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`
          )

          const airtableInput = await fetchAndProcessAirtablePayloads(
            {
              id: payload.webhookId,
              provider: payload.provider,
              providerConfig: webhookRows[0].providerConfig,
            },
            workflowRef,
            requestId
          )

          if (!airtableInput) {
            logger.info(`[${requestId}] No Airtable changes to process`)
            return completeSkippedWebhookExecution({
              payload,
              executionId,
              requestId,
              workspaceId: scopedWorkspaceId,
              workflowState: blueprint.workflowData,
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
            concurrencyLeaseInherited: true,
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
          mockRequest
        )

        if (!input && payload.provider === 'whatsapp') {
          logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)
          return completeSkippedWebhookExecution({
            payload,
            executionId,
            requestId,
            workspaceId: scopedWorkspaceId,
            workflowState: blueprint.workflowData,
            triggerData,
            message: 'No messages in WhatsApp payload',
          })
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
          concurrencyLeaseInherited: true,
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
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Webhook execution failed`, {
      error: error.message,
      stack: error.stack,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    if (!runnerInvoked && error instanceof Error && workspaceId && workflowState) {
      await logWebhookFailure({
        payload,
        executionId,
        requestId,
        workspaceId,
        workflowState,
        triggerData,
        error,
      })
    }

    throw error
  }
}
