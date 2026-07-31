import { db } from '@tradinggoose/db'
import { webhook } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  finalizeWorkflowExecution,
  type WorkflowExecutionLifecycle,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import { createWorkflowExecutionRuntime } from '@/lib/execution/workflow-execution-runtime'
import { createLogger } from '@/lib/logs/console/logger'
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
  },
  signal?: AbortSignal
): Promise<any> {
  signal?.throwIfAborted()
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed: any = Array.isArray(input) ? [] : {}

  for (const [key, value] of Object.entries(input)) {
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
  }

  return processed
}

export type WebhookExecutionPayload = {
  webhookId: string
  workflowId: string
  userId: string
  executionId?: string
  drainRunId?: string
  workflowExecutionLifecycle?: WorkflowExecutionLifecycle
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

export async function executeWebhookJob(payload: WebhookExecutionPayload) {
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  const executionTarget = payload.executionTarget ?? 'deployed'
  if (!payload.workflowExecutionLifecycle) {
    throw new Error(`Webhook workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const deadlineRuntime = createWorkflowExecutionRuntime(
    payload.workflowExecutionLifecycle,
    (error) => logger.error(`[${requestId}] Workflow deadline heartbeat failed`, error)
  )

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

  let blueprint: WorkflowExecutionBlueprint
  try {
    await deadlineRuntime.start()
    deadlineRuntime.signal?.throwIfAborted()
    blueprint = await loadWorkflowExecutionBlueprint({
      workflowId: payload.workflowId,
      executionTarget,
    })
    deadlineRuntime.signal?.throwIfAborted()
    if (!blueprint.workflowContext.workspaceId) {
      throw new Error(`Workflow ${payload.workflowId} is missing workspace scope`)
    }
  } catch (error) {
    if (payload.workflowExecutionLifecycle) {
      await deadlineRuntime.settleStartup(
        deadlineRuntime.signal?.aborted ? 'local_abort' : 'failed'
      )
      await finalizeWorkflowExecution({
        rootExecutionId: payload.workflowExecutionLifecycle.policy.rootExecutionId,
        attemptId: payload.workflowExecutionLifecycle.attemptId,
        result: {
          success: false,
          output: {},
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
    deadlineRuntime.close()
    throw error
  }

  try {
    const scopedWorkspaceId = blueprint.workflowContext.workspaceId!
    const { result } = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: payload.userId,
      requestId,
      executionId,
      lifecycle: payload.workflowExecutionLifecycle,
      deadlineRuntime,
      triggerType: 'webhook',
      workflowInput: {},
      triggerTarget: {
        kind: 'block',
        blockId: payload.blockId,
      },
      triggerData,
      prepareWorkflowInput: async ({ signal }) => {
        signal?.throwIfAborted()
        const blocks = blueprint.workflowData.blocks
        const webhookRows = await db
          .select()
          .from(webhook)
          .where(eq(webhook.id, payload.webhookId))
          .limit(1)
        signal?.throwIfAborted()
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
          if (!webhookRows[0]) throw new Error(`Webhook record not found: ${payload.webhookId}`)
          const airtableInput = await fetchAndProcessAirtablePayloads(
            {
              id: payload.webhookId,
              provider: payload.provider,
              providerConfig: webhookRows[0].providerConfig,
            },
            workflowRef,
            requestId,
            signal
          )
          signal?.throwIfAborted()
          return airtableInput
            ? { kind: 'execute' as const, workflowInput: airtableInput }
            : {
                kind: 'skip' as const,
                result: {
                  success: true,
                  output: { message: 'No Airtable changes to process' },
                  logs: [],
                },
              }
        }

        const mockRequest = { headers: new Map(Object.entries(payload.headers)) } as any
        const input = await formatWebhookInput(
          webhookRecord,
          workflowRef,
          payload.body,
          mockRequest,
          signal
        )
        signal?.throwIfAborted()
        if (!input && payload.provider === 'whatsapp') {
          return {
            kind: 'skip' as const,
            result: {
              success: true,
              output: { message: 'No messages in WhatsApp payload' },
              logs: [],
            },
          }
        }
        if (input && blocks[payload.blockId]) {
          const triggerId = resolveTriggerIdForBlock(blocks[payload.blockId])
          const triggerConfig = triggerId ? getTrigger(triggerId) : undefined
          if (triggerConfig?.outputs) {
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
                signal
              )
            )
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
              signal,
            })
          )
          signal?.throwIfAborted()
        }
        return { kind: 'execute' as const, workflowInput: input || {} }
      },
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

    throw error
  } finally {
    deadlineRuntime.close()
  }
}
