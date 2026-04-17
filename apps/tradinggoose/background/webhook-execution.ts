import { db } from '@tradinggoose/db'
import { webhook, workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { withExecutionConcurrencyLimit } from '@/lib/execution/execution-concurrency-limit'
import { processExecutionFiles } from '@/lib/execution/files'
import { toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
import { getTrigger } from '@/triggers'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'

const logger = createLogger('TriggerWebhookExecution')

/**
 * Process trigger outputs based on their schema definitions
 * Finds outputs marked as 'file' or 'file[]' and uploads them to execution storage
 */
async function processTriggerFileOutputs(
  input: any,
  triggerOutputs: Record<string, any>,
  context: {
    workspaceId: string
    workflowId: string
    executionId: string
    requestId: string
  },
  path = ''
): Promise<any> {
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed: any = Array.isArray(input) ? [] : {}

  for (const [key, value] of Object.entries(input)) {
    const currentPath = path ? `${path}.${key}` : key
    const outputDef = triggerOutputs[key]
    const val: any = value

    // If this field is marked as file or file[], process it
    if (outputDef?.type === 'file[]' && Array.isArray(val)) {
      try {
        processed[key] = await WebhookAttachmentProcessor.processAttachments(val as any, context)
      } catch (error) {
        processed[key] = []
      }
    } else if (outputDef?.type === 'file' && val) {
      try {
        const [processedFile] = await WebhookAttachmentProcessor.processAttachments(
          [val as any],
          context
        )
        processed[key] = processedFile
      } catch (error) {
        logger.error(`[${context.requestId}] Error processing ${currentPath}:`, error)
        processed[key] = val
      }
    } else if (outputDef && typeof outputDef === 'object' && !outputDef.type) {
      // Nested object in schema - recurse with the nested schema
      processed[key] = await processTriggerFileOutputs(val, outputDef, context, currentPath)
    } else {
      // Not a file output - keep as is
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

export async function executeWebhookJob(payload: WebhookExecutionPayload) {
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting webhook execution`, {
    webhookId: payload.webhookId,
    workflowId: payload.workflowId,
    provider: payload.provider,
    userId: payload.userId,
    executionId,
  })

  return withExecutionConcurrencyLimit({
    userId: payload.userId,
    workflowId: payload.workflowId,
    task: () => executeWebhookJobInternal(payload, executionId, requestId),
  })
}

async function executeWebhookJobInternal(
  payload: WebhookExecutionPayload,
  executionId: string,
  requestId: string
) {
  const loggingSession = new LoggingSession(payload.workflowId, executionId, 'webhook', requestId)

  try {
    const usageCheck = await checkServerSideUsageLimits({
      userId: payload.userId,
      workflowId: payload.workflowId,
    })
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping webhook execution.`,
        {
          actorUserId: payload.userId,
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: payload.workflowId,
        }
      )
      throw new Error(
        usageCheck.message ||
          'Usage limit exceeded. Please upgrade your billing tier to continue using webhooks.'
      )
    }

    // Load workflow state based on execution target
    const workflowData =
      payload.executionTarget === 'live'
        ? await loadWorkflowFromNormalizedTables(payload.workflowId)
        : await loadDeployedWorkflowState(payload.workflowId)
    if (!workflowData) {
      throw new Error(`Workflow ${payload.workflowId} has no live normalized state`)
    }

    const { blocks, edges, loops, parallels } = workflowData

    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, payload.workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId || undefined

    const decryptedEnvVars = await getEffectiveDecryptedEnv(payload.userId, workspaceId)

    // Start logging session
    const indicatorTriggerData = buildIndicatorTriggerData(payload)

    await loggingSession.safeStart({
      userId: payload.userId,
      workspaceId: workspaceId || '',
      variables: decryptedEnvVars,
      triggerData: {
        isTest: payload.testMode === true,
        executionTarget: payload.executionTarget || 'deployed',
        ...(indicatorTriggerData ?? {}),
      },
    })

    // Merge subblock states (matching workflow-execution pattern)
    const mergedStates = mergeSubblockState(blocks, {})

    // Process block states for execution
    const processedBlockStates = Object.entries(mergedStates).reduce(
      (acc, [blockId, blockState]) => {
        acc[blockId] = Object.entries(blockState.subBlocks).reduce(
          (subAcc, [key, subBlock]) => {
            subAcc[key] = subBlock.value
            return subAcc
          },
          {} as Record<string, any>
        )
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    // Handle workflow variables (for now, use empty object since we don't have workflow metadata)
    const workflowVariables = {}

    // Create serialized workflow
    const serializer = new Serializer()
    const serializedWorkflow = serializer.serializeWorkflow(
      mergedStates,
      edges,
      loops || {},
      parallels || {},
      true // Enable validation during execution
    )

    // Handle special Airtable case
    if (payload.provider === 'airtable') {
      logger.info(`[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`)

      // Load the actual webhook record from database to get providerConfig
      const [webhookRecord] = await db
        .select()
        .from(webhook)
        .where(eq(webhook.id, payload.webhookId))
        .limit(1)

      if (!webhookRecord) {
        throw new Error(`Webhook record not found: ${payload.webhookId}`)
      }

      const webhookData = {
        id: payload.webhookId,
        provider: payload.provider,
        providerConfig: webhookRecord.providerConfig,
      }

      // Create a mock workflow object for Airtable processing
      const mockWorkflow = {
        id: payload.workflowId,
        userId: payload.userId,
      }

      // Get the processed Airtable input
      const airtableInput = await fetchAndProcessAirtablePayloads(
        webhookData,
        mockWorkflow,
        requestId
      )

      // If we got input (changes), execute the workflow like other providers
      if (airtableInput) {
        logger.info(`[${requestId}] Executing workflow with Airtable changes`)

        // Create executor and execute (same as standard webhook flow)
        const executor = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: airtableInput,
          workflowVariables,
          contextExtensions: {
            executionId,
            workspaceId: workspaceId || '',
            userId: payload.userId,
            concurrencyLeaseInherited: true,
            isDeployedContext: !payload.testMode,
          },
        })

        // Set up logging on the executor
        loggingSession.setupExecutor(executor)

        // Execute the workflow
        const result = await executor.execute(payload.workflowId, payload.blockId)

        // Check if we got a StreamingExecution result
        const executionResult =
          'stream' in result && 'execution' in result ? result.execution : result

        logger.info(`[${requestId}] Airtable webhook execution completed`, {
          success: executionResult.success,
          workflowId: payload.workflowId,
        })

        // Update workflow run counts on success
        if (executionResult.success) {
          await updateWorkflowRunCounts(payload.workflowId)
        }

        // Build trace spans and complete logging session
        const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || 0,
          finalOutput: executionResult.output || {},
          traceSpans: traceSpans as any,
          workflowInput: airtableInput,
        })

        return {
          success: executionResult.success,
          workflowId: payload.workflowId,
          executionId,
          output: executionResult.output,
          executedAt: new Date().toISOString(),
          provider: payload.provider,
        }
      }
      // No changes to process
      logger.info(`[${requestId}] No Airtable changes to process`)

      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        finalOutput: { message: 'No Airtable changes to process' },
        traceSpans: [],
      })

      return {
        success: true,
        workflowId: payload.workflowId,
        executionId,
        output: { message: 'No Airtable changes to process' },
        executedAt: new Date().toISOString(),
      }
    }

    // Format input for standard webhooks using the stored provider config.
    const webhookRows = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, payload.webhookId))
      .limit(1)

    const actualWebhook =
      webhookRows.length > 0
        ? webhookRows[0]
        : {
            provider: payload.provider,
            blockId: payload.blockId,
            providerConfig: {},
          }

    const mockWorkflow = {
      id: payload.workflowId,
      userId: payload.userId,
    }
    const mockRequest = {
      headers: new Map(Object.entries(payload.headers)),
    } as any

    const input = await formatWebhookInput(actualWebhook, mockWorkflow, payload.body, mockRequest)

    if (!input && payload.provider === 'whatsapp') {
      logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)
      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        finalOutput: { message: 'No messages in WhatsApp payload' },
        traceSpans: [],
      })
      return {
        success: true,
        workflowId: payload.workflowId,
        executionId,
        output: { message: 'No messages in WhatsApp payload' },
        executedAt: new Date().toISOString(),
      }
    }

    // Process trigger file outputs based on schema
    if (input && payload.blockId && blocks[payload.blockId]) {
      try {
        const triggerBlock = blocks[payload.blockId]
        const triggerId = triggerBlock ? resolveTriggerIdForBlock(triggerBlock) : null

        if (triggerId && typeof triggerId === 'string') {
          const triggerConfig = getTrigger(triggerId)

          if (triggerConfig?.outputs) {
            logger.debug(`[${requestId}] Processing trigger ${triggerId} file outputs`)
            const processedInput = await processTriggerFileOutputs(input, triggerConfig.outputs, {
              workspaceId: workspaceId || '',
              workflowId: payload.workflowId,
              executionId,
              requestId,
            })
            Object.assign(input, processedInput)
          }
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing trigger file outputs:`, error)
        // Continue without processing attachments rather than failing execution
      }
    }

    // Process generic webhook files based on inputFormat
    if (input && payload.provider === 'generic' && payload.blockId && blocks[payload.blockId]) {
      try {
        const triggerBlock = blocks[payload.blockId]

        if (triggerBlock?.subBlocks?.inputFormat?.value) {
          const inputFormat = triggerBlock.subBlocks.inputFormat.value as unknown as Array<{
            name: string
            type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
          }>
          logger.debug(`[${requestId}] Processing generic webhook files from inputFormat`)

          const fileFields = inputFormat.filter((field) => field.type === 'files')

          if (fileFields.length > 0 && typeof input === 'object' && input !== null) {
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
                  requestId
                )

                if (uploadedFiles.length > 0) {
                  input[fileField.name] = uploadedFiles
                  logger.info(
                    `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
                  )
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing generic webhook files:`, error)
        // Continue without processing files rather than failing execution
      }
    }

    // Create executor and execute
    const executor = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: input || {},
      workflowVariables,
      contextExtensions: {
        executionId,
        workspaceId: workspaceId || '',
        userId: payload.userId,
        concurrencyLeaseInherited: true,
        isDeployedContext: !payload.testMode,
      },
    })

    // Set up logging on the executor
    loggingSession.setupExecutor(executor)

    logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

    // Execute the workflow
    const result = await executor.execute(payload.workflowId, payload.blockId)

    // Check if we got a StreamingExecution result
    const executionResult = 'stream' in result && 'execution' in result ? result.execution : result

    logger.info(`[${requestId}] Webhook execution completed`, {
      success: executionResult.success,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    // Update workflow run counts on success
    if (executionResult.success) {
      await updateWorkflowRunCounts(payload.workflowId)
    }

    // Build trace spans and complete logging session
    const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: executionResult.output || {},
      traceSpans: traceSpans as any,
      workflowInput: input,
    })

    return {
      success: executionResult.success,
      workflowId: payload.workflowId,
      executionId,
      output: executionResult.output,
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

    // Complete logging session with error (matching workflow-execution pattern)
    try {
      const executionResult = (error?.executionResult as ExecutionResult | undefined) || {
        success: false,
        output: {},
        logs: [],
      }
      const { traceSpans } = buildTraceSpans(executionResult)

      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        error: {
          message: error.message || 'Webhook execution failed',
          stackTrace: error.stack,
        },
        traceSpans,
      })
    } catch (loggingError) {
      logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
    }

    throw error
  }
}
