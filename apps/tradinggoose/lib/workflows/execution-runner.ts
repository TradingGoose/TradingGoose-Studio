import { db } from '@tradinggoose/db'
import { workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { withExecutionConcurrencyController } from '@/lib/execution/execution-concurrency-limit'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils-server'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { normalizeVariables } from '@/lib/workflows/variable-utils'
import { Executor } from '@/executor'
import type {
  ExecutionContextExtensions,
  ExecutionResult,
} from '@/executor/types'
import { Serializer } from '@/serializer'
import type { TriggerType } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('WorkflowExecutionRunner')

export type WorkflowExecutionTarget = 'deployed' | 'live'

type WorkflowContextHint = {
  workspaceId?: string | null
  variables?: unknown
}

type ResolvedWorkflowExecutionContext = {
  workspaceId: string
  variables: unknown
}

export type WorkflowStart =
  | {
      kind: 'trigger'
      triggerType: 'api' | 'chat' | 'manual'
    }
  | {
      kind: 'block'
      blockId?: string
    }

export type WorkflowExecutionBlueprint = {
  workflowId: string
  executionTarget: WorkflowExecutionTarget
  workflowContext: ResolvedWorkflowExecutionContext
  workflowData: {
    blocks: Record<string, any>
    edges: any[]
    loops: Record<string, any>
    parallels: Record<string, any>
  }
}

export type WorkflowRunnerExecutionResult = ExecutionResult

export type WorkflowRunnerResult = {
  executionId: string
  result: WorkflowRunnerExecutionResult
  workflowData: WorkflowExecutionBlueprint['workflowData']
  workspaceId: string
}

export class WorkflowUsageLimitError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 402) {
    super(message)
    this.name = 'WorkflowUsageLimitError'
    this.statusCode = statusCode
  }
}

async function resolveRequiredWorkflowExecutionContext(
  workflowId: string,
  workflowContext?: WorkflowContextHint
): Promise<ResolvedWorkflowExecutionContext> {
  const providedWorkspaceId =
    typeof workflowContext?.workspaceId === 'string' && workflowContext.workspaceId.length > 0
      ? workflowContext.workspaceId
      : null
  const needsWorkflowRecord = !providedWorkspaceId || workflowContext?.variables === undefined
  let workflowRecord:
    | {
        workspaceId: string | null
        variables: unknown
      }
    | undefined

  if (needsWorkflowRecord) {
    ;[workflowRecord] = await db
      .select({
        workspaceId: workflowTable.workspaceId,
        variables: workflowTable.variables,
      })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)
  }

  const workspaceId = providedWorkspaceId ?? workflowRecord?.workspaceId

  if (!workspaceId) {
    throw new Error(`Workflow ${workflowId} is missing workspace scope`)
  }

  return {
    workspaceId,
    variables: workflowContext?.variables ?? workflowRecord?.variables ?? {},
  }
}

async function decryptEnvironmentVariables(
  encryptedEnvVars: Record<string, string>
): Promise<Record<string, string>> {
  const decryptedEnvVars: Record<string, string> = {}

  for (const [key, encryptedValue] of Object.entries(encryptedEnvVars)) {
    try {
      const { decrypted } = await decryptSecret(encryptedValue)
      decryptedEnvVars[key] = decrypted
    } catch (error: any) {
      throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
    }
  }

  return decryptedEnvVars
}

function buildProcessedBlockStates(
  mergedStates: Record<string, any>,
  decryptedEnvVars: Record<string, string>
): Record<string, Record<string, any>> {
  const processedBlockStates: Record<string, Record<string, any>> = {}

  for (const [blockId, block] of Object.entries(mergedStates)) {
    const blockState: Record<string, any> = {}

    for (const [key, subBlock] of Object.entries(block.subBlocks)) {
      let value = (subBlock as { value?: unknown }).value

      if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
        let stringValue = value
        const matches = value.match(/{{([^}]+)}}/g)

        if (matches) {
          for (const match of matches) {
            const variableName = match.slice(2, -2)
            const decryptedValue = decryptedEnvVars[variableName]

            if (decryptedValue === undefined) {
              throw new Error(`Environment variable "${variableName}" was not found`)
            }

            stringValue = stringValue.replace(match, decryptedValue)
          }
        }

        value = stringValue
      }

      blockState[key] = value
    }

    if (typeof blockState.responseFormat === 'string') {
      const responseFormatValue = blockState.responseFormat.trim()

      if (responseFormatValue === '') {
        blockState.responseFormat = undefined
      } else if (!(responseFormatValue.startsWith('<') && responseFormatValue.includes('>'))) {
        try {
          blockState.responseFormat = JSON.parse(responseFormatValue)
        } catch {
          blockState.responseFormat = undefined
        }
      }
    }

    processedBlockStates[blockId] = blockState
  }

  return processedBlockStates
}

function resolveStartBlockId(params: {
  mergedStates: Record<string, any>
  serializedWorkflow: { connections: Array<{ source: string }> }
  start: WorkflowStart
}) {
  if (params.start.kind === 'trigger') {
    const startBlock = TriggerUtils.findStartBlock(
      params.mergedStates,
      params.start.triggerType,
      false
    )

    if (!startBlock) {
      const triggerName =
        params.start.triggerType === 'api'
          ? 'API'
          : params.start.triggerType === 'chat'
            ? 'Chat'
            : 'Manual'
      throw new Error(
        `No ${triggerName} trigger block found. Add a ${triggerName} Trigger block to this workflow.`
      )
    }

    const outgoingConnections = params.serializedWorkflow.connections.filter(
      (connection) => connection.source === startBlock.blockId
    )

    if (outgoingConnections.length === 0) {
      throw new Error('Trigger block must be connected to other blocks to execute')
    }

    return startBlock.blockId
  }

  if (
    params.start.kind === 'block' &&
    params.start.blockId &&
    !params.mergedStates[params.start.blockId]
  ) {
    throw new Error(`Workflow does not contain trigger block ${params.start.blockId}`)
  }

  if (params.start.kind === 'block' && params.start.blockId) {
    const blockId = params.start.blockId
    const outgoingConnections = params.serializedWorkflow.connections.filter(
      (connection) => connection.source === blockId
    )

    if (outgoingConnections.length === 0) {
      throw new Error(`Trigger block ${blockId} must be connected to other blocks to execute`)
    }
  }

  return params.start.blockId
}

export async function loadWorkflowExecutionBlueprint(params: {
  workflowId: string
  executionTarget?: WorkflowExecutionTarget
  workflowContext?: WorkflowContextHint
  workflowData?: WorkflowExecutionBlueprint['workflowData']
}): Promise<WorkflowExecutionBlueprint> {
  const executionTarget = params.executionTarget ?? 'deployed'
  const workflowContext = await resolveRequiredWorkflowExecutionContext(
    params.workflowId,
    params.workflowContext
  )
  const workflowData =
    params.workflowData ??
    (executionTarget === 'live'
      ? await loadWorkflowFromNormalizedTables(params.workflowId)
      : await loadDeployedWorkflowState(params.workflowId))

  if (!workflowData) {
    throw new Error(`Workflow ${params.workflowId} has no ${executionTarget} state`)
  }

  return {
    workflowId: params.workflowId,
    executionTarget,
    workflowContext,
    workflowData: {
      blocks: workflowData.blocks || {},
      edges: workflowData.edges || [],
      loops: workflowData.loops || {},
      parallels: workflowData.parallels || {},
    },
  }
}

export async function runPreparedWorkflowExecution(params: {
  blueprint: WorkflowExecutionBlueprint
  actorUserId: string
  triggerType: TriggerType
  workflowInput: unknown
  start: WorkflowStart
  requestId?: string
  executionId?: string
  triggerData?: Record<string, unknown>
  contextExtensions?: Partial<ExecutionContextExtensions>
  concurrencyLeaseInherited?: boolean
}): Promise<WorkflowRunnerResult> {
  const executionId = params.executionId ?? uuidv4()
  const requestId = params.requestId ?? executionId.slice(0, 8)
  const workspaceId = params.blueprint.workflowContext.workspaceId
  const loggingTriggerType = params.triggerType === 'api-endpoint' ? 'api' : params.triggerType
  const loggingSession = new LoggingSession(
    params.blueprint.workflowId,
    executionId,
    loggingTriggerType,
    requestId
  )

  return withExecutionConcurrencyController({
    concurrencyLeaseInherited: params.concurrencyLeaseInherited,
    userId: params.actorUserId,
    workflowId: params.blueprint.workflowId,
    workspaceId,
    task: async (executionConcurrencyController) => {
      const usageCheck = await checkServerSideUsageLimits({
        userId: params.actorUserId,
        workflowId: params.blueprint.workflowId,
        workspaceId,
      })

      if (usageCheck.isExceeded) {
        throw new WorkflowUsageLimitError(
          usageCheck.message ||
            'Usage limit exceeded. Please upgrade your billing tier to continue.'
        )
      }

      let workflowLogStarted = false
      try {
        const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
          params.actorUserId,
          workspaceId
        )
        const encryptedEnvVars = {
          ...personalEncrypted,
          ...workspaceEncrypted,
        }
        const decryptedEnvVars = await decryptEnvironmentVariables(encryptedEnvVars)
        const mergedStates = mergeSubblockState(params.blueprint.workflowData.blocks, {})
        const processedBlockStates = buildProcessedBlockStates(mergedStates, decryptedEnvVars)
        const serializedWorkflow = new Serializer().serializeWorkflow(
          mergedStates,
          params.blueprint.workflowData.edges,
          params.blueprint.workflowData.loops,
          params.blueprint.workflowData.parallels,
          true
        )
        const workflowVariables = normalizeVariables(params.blueprint.workflowContext.variables)

        const workflowLogId = await loggingSession.start({
          userId: params.actorUserId,
          workspaceId,
          variables: encryptedEnvVars,
          triggerData: params.triggerData,
        })
        workflowLogStarted = true

        const contextExtensions: ExecutionContextExtensions = {
          ...params.contextExtensions,
          executionId,
          workspaceId,
          userId: params.actorUserId,
          concurrencyLeaseInherited: true,
          executionConcurrencyController,
          isDeployedContext: params.blueprint.executionTarget !== 'live',
          triggerType: params.triggerType,
          workflowDepth: params.contextExtensions?.workflowDepth ?? 0,
          submissionSource: 'workflow',
          workflowLogId,
        }

        if (contextExtensions.stream) {
          contextExtensions.edges = params.blueprint.workflowData.edges.map((edge: any) => ({
            source: edge.source,
            target: edge.target,
          }))
        }

        const executor = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: params.workflowInput,
          workflowVariables,
          contextExtensions,
        })

        const startBlockId = resolveStartBlockId({
          mergedStates,
          serializedWorkflow,
          start: params.start,
        })

        const result = await executor.execute(params.blueprint.workflowId, startBlockId)

        const { traceSpans, totalDuration } = buildTraceSpans(result)

        if (result.success) {
          await updateWorkflowRunCounts(params.blueprint.workflowId).catch((error) =>
            logger.error(`[${requestId}] Workflow run count update failed after execution`, error)
          )
        }

        await loggingSession
          .complete({
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            finalOutput: result.output === undefined ? {} : result.output,
            traceSpans: traceSpans || [],
            workflowInput: params.workflowInput,
          })
          .catch((error) =>
            logger.error(`[${requestId}] Workflow log completion failed after execution`, error)
          )

        return {
          executionId,
          result,
          workflowData: params.blueprint.workflowData,
          workspaceId,
        }
      } catch (error: any) {
        const executionResultForError = (error?.executionResult as ExecutionResult | undefined) || {
          success: false,
          output: {},
          logs: [],
        }
        const { traceSpans } = buildTraceSpans(executionResultForError)

        if (workflowLogStarted) {
          await loggingSession
            .completeWithError({
              endedAt: new Date().toISOString(),
              totalDurationMs: 0,
              error: {
                message: error.message || 'Workflow execution failed',
                stackTrace: error.stack,
              },
              traceSpans,
            })
            .catch((loggingError) =>
              logger.error(`[${requestId}] Workflow error log completion failed`, loggingError)
            )
        }

        throw error
      }
    },
  })
}

export async function runWorkflowExecution(params: {
  workflowId: string
  actorUserId: string
  triggerType: TriggerType
  workflowInput: unknown
  start: WorkflowStart
  executionTarget?: WorkflowExecutionTarget
  workflowContext?: WorkflowContextHint
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  requestId?: string
  executionId?: string
  triggerData?: Record<string, unknown>
  contextExtensions?: Partial<ExecutionContextExtensions>
  concurrencyLeaseInherited?: boolean
}): Promise<WorkflowRunnerResult> {
  const blueprint = await loadWorkflowExecutionBlueprint({
    workflowId: params.workflowId,
    executionTarget: params.executionTarget,
    workflowContext: params.workflowContext,
    workflowData: params.workflowData,
  })

  return runPreparedWorkflowExecution({
    blueprint,
    actorUserId: params.actorUserId,
    triggerType: params.triggerType,
    workflowInput: params.workflowInput,
    start: params.start,
    requestId: params.requestId,
    executionId: params.executionId,
    triggerData: params.triggerData,
    contextExtensions: params.contextExtensions,
    concurrencyLeaseInherited: params.concurrencyLeaseInherited,
  })
}
