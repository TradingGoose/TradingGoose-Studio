import { db } from '@tradinggoose/db'
import { workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { withExecutionConcurrencyLimit } from '@/lib/execution/execution-concurrency-limit'
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
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { TriggerType } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

type WorkflowExecutionTarget = 'deployed' | 'live'

type WorkflowContextHint = {
  workspaceId?: string | null
  variables?: unknown
}

type WorkflowStart =
  | {
      kind: 'trigger'
      triggerType: 'api' | 'chat'
    }
  | {
      kind: 'block'
      blockId?: string
    }

type WorkflowStreamOptions = {
  selectedOutputs?: string[]
  onStream?: (streamingExec: {
    stream: ReadableStream
    execution?: { blockId?: string }
  }) => Promise<void>
  onBlockComplete?: (blockId: string, output: unknown) => Promise<void>
  skipLoggingComplete?: boolean
}

export type WorkflowExecutionBlueprint = {
  workflowId: string
  executionTarget: WorkflowExecutionTarget
  workflowContext: Required<WorkflowContextHint>
  workflowData: {
    blocks: Record<string, any>
    edges: any[]
    loops: Record<string, any>
    parallels: Record<string, any>
  }
}

export type WorkflowRunnerExecutionResult = ExecutionResult & {
  _streamingMetadata?: {
    loggingSession: LoggingSession
    processedInput: unknown
  }
}

export type WorkflowRunnerResult = {
  executionId: string
  result: WorkflowRunnerExecutionResult
  workflowData: WorkflowExecutionBlueprint['workflowData']
  workspaceId?: string | null
}

export class WorkflowUsageLimitError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 402) {
    super(message)
    this.name = 'WorkflowUsageLimitError'
    this.statusCode = statusCode
  }
}

async function resolveWorkflowContext(
  workflowId: string,
  workflowContext?: WorkflowContextHint,
): Promise<Required<WorkflowContextHint>> {
  if (workflowContext) {
    return {
      workspaceId: workflowContext.workspaceId ?? null,
      variables: workflowContext.variables ?? {},
    }
  }

  const [workflowRecord] = await db
    .select({
      workspaceId: workflowTable.workspaceId,
      variables: workflowTable.variables,
    })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  return {
    workspaceId: workflowRecord?.workspaceId ?? null,
    variables: workflowRecord?.variables ?? {},
  }
}

async function decryptEnvironmentVariables(
  encryptedEnvVars: Record<string, string>,
): Promise<Record<string, string>> {
  const decryptedEnvVars: Record<string, string> = {}

  for (const [key, encryptedValue] of Object.entries(encryptedEnvVars)) {
    try {
      const { decrypted } = await decryptSecret(encryptedValue)
      decryptedEnvVars[key] = decrypted
    } catch (error: any) {
      throw new Error(
        `Failed to decrypt environment variable "${key}": ${error.message}`,
      )
    }
  }

  return decryptedEnvVars
}

function buildProcessedBlockStates(
  mergedStates: Record<string, any>,
  decryptedEnvVars: Record<string, string>,
): Record<string, Record<string, any>> {
  const processedBlockStates: Record<string, Record<string, any>> = {}

  for (const [blockId, block] of Object.entries(mergedStates)) {
    const blockState: Record<string, any> = {}

    for (const [key, subBlock] of Object.entries(block.subBlocks)) {
      let value = subBlock.value

      if (
        typeof value === 'string' &&
        value.includes('{{') &&
        value.includes('}}')
      ) {
        const matches = value.match(/{{([^}]+)}}/g)

        if (matches) {
          for (const match of matches) {
            const variableName = match.slice(2, -2)
            const decryptedValue = decryptedEnvVars[variableName]

            if (decryptedValue === undefined) {
              throw new Error(
                `Environment variable "${variableName}" was not found`,
              )
            }

            value = value.replace(match, decryptedValue)
          }
        }
      }

      blockState[key] = value
    }

    if (typeof blockState.responseFormat === 'string') {
      const responseFormatValue = blockState.responseFormat.trim()

      if (responseFormatValue === '') {
        blockState.responseFormat = undefined
      } else if (
        !(
          responseFormatValue.startsWith('<') &&
          responseFormatValue.includes('>')
        )
      ) {
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
      false,
    )

    if (!startBlock) {
      throw new Error(
        params.start.triggerType === 'api'
          ? 'No API trigger block found. Add an API Trigger block to this workflow.'
          : 'No chat trigger block found. Add a Chat Trigger block to this workflow.',
      )
    }

    const outgoingConnections = params.serializedWorkflow.connections.filter(
      (connection) => connection.source === startBlock.blockId,
    )

    if (outgoingConnections.length === 0) {
      throw new Error(
        'Trigger block must be connected to other blocks to execute',
      )
    }

    return startBlock.blockId
  }

  if (params.start.blockId && !params.mergedStates[params.start.blockId]) {
    throw new Error(
      `Workflow does not contain trigger block ${params.start.blockId}`,
    )
  }

  if (params.start.blockId) {
    const outgoingConnections = params.serializedWorkflow.connections.filter(
      (connection) => connection.source === params.start.blockId,
    )

    if (outgoingConnections.length === 0) {
      throw new Error(
        `Trigger block ${params.start.blockId} must be connected to other blocks to execute`,
      )
    }
  }

  return params.start.blockId
}

export async function loadWorkflowExecutionBlueprint(params: {
  workflowId: string
  executionTarget?: WorkflowExecutionTarget
  workflowContext?: WorkflowContextHint
}): Promise<WorkflowExecutionBlueprint> {
  const executionTarget = params.executionTarget ?? 'deployed'
  const workflowData =
    executionTarget === 'live'
      ? await loadWorkflowFromNormalizedTables(params.workflowId)
      : await loadDeployedWorkflowState(params.workflowId)

  if (!workflowData) {
    throw new Error(
      `Workflow ${params.workflowId} has no ${executionTarget} state`,
    )
  }

  const workflowContext = await resolveWorkflowContext(
    params.workflowId,
    params.workflowContext,
  )

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
  stream?: WorkflowStreamOptions
  contextExtensions?: Record<string, unknown>
}): Promise<WorkflowRunnerResult> {
  const executionId = params.executionId ?? uuidv4()
  const requestId = params.requestId ?? executionId.slice(0, 8)
  const workspaceId = params.blueprint.workflowContext.workspaceId ?? undefined
  const loggingSession = new LoggingSession(
    params.blueprint.workflowId,
    executionId,
    params.triggerType,
    requestId,
  )

  return withExecutionConcurrencyLimit({
    userId: params.actorUserId,
    workflowId: params.blueprint.workflowId,
    workspaceId,
    task: async () => {
      const usageCheck = await checkServerSideUsageLimits({
        userId: params.actorUserId,
        workflowId: params.blueprint.workflowId,
        workspaceId,
      })

      if (usageCheck.isExceeded) {
        throw new WorkflowUsageLimitError(
          usageCheck.message ||
            'Usage limit exceeded. Please upgrade your billing tier to continue.',
        )
      }

      try {
        const { personalEncrypted, workspaceEncrypted } =
          await getPersonalAndWorkspaceEnv(params.actorUserId, workspaceId)
        const encryptedEnvVars = {
          ...personalEncrypted,
          ...workspaceEncrypted,
        }
        const decryptedEnvVars =
          await decryptEnvironmentVariables(encryptedEnvVars)
        const mergedStates = mergeSubblockState(
          params.blueprint.workflowData.blocks,
          {},
        )
        const processedBlockStates = buildProcessedBlockStates(
          mergedStates,
          decryptedEnvVars,
        )
        const serializedWorkflow = new Serializer().serializeWorkflow(
          mergedStates,
          params.blueprint.workflowData.edges,
          params.blueprint.workflowData.loops,
          params.blueprint.workflowData.parallels,
          true,
        )
        const workflowVariables = normalizeVariables(
          params.blueprint.workflowContext.variables,
        )

        await loggingSession.safeStart({
          userId: params.actorUserId,
          workspaceId,
          variables: encryptedEnvVars,
          triggerData: params.triggerData,
        })

        const contextExtensions: Record<string, unknown> = {
          executionId,
          workspaceId: workspaceId || '',
          userId: params.actorUserId,
          concurrencyLeaseInherited: true,
          isDeployedContext: params.blueprint.executionTarget !== 'live',
          ...params.contextExtensions,
        }

        if (params.stream) {
          contextExtensions.stream = true
          contextExtensions.selectedOutputs =
            params.stream.selectedOutputs || []
          contextExtensions.edges = params.blueprint.workflowData.edges.map(
            (edge: any) => ({
              source: edge.source,
              target: edge.target,
            }),
          )
          contextExtensions.onStream = params.stream.onStream
          contextExtensions.onBlockComplete = params.stream.onBlockComplete
        }

        const executor = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: params.workflowInput,
          workflowVariables,
          contextExtensions,
        })

        loggingSession.setupExecutor(executor)

        const startBlockId = resolveStartBlockId({
          mergedStates,
          serializedWorkflow,
          start: params.start,
        })

        const rawResult = await executor.execute(
          params.blueprint.workflowId,
          startBlockId,
        )
        const result = (
          'stream' in rawResult && 'execution' in rawResult
            ? rawResult.execution
            : rawResult
        ) as WorkflowRunnerExecutionResult

        const { traceSpans, totalDuration } = buildTraceSpans(result)

        if (result.success) {
          await updateWorkflowRunCounts(params.blueprint.workflowId)
        }

        if (params.stream?.skipLoggingComplete) {
          result._streamingMetadata = {
            loggingSession,
            processedInput: params.workflowInput,
          }
        } else {
          await loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: traceSpans || [],
            workflowInput: params.workflowInput,
          })
        }

        return {
          executionId,
          result,
          workflowData: params.blueprint.workflowData,
          workspaceId,
        }
      } catch (error: any) {
        const executionResultForError = (error?.executionResult as
          | ExecutionResult
          | undefined) || {
          success: false,
          output: {},
          logs: [],
        }
        const { traceSpans } = buildTraceSpans(executionResultForError)

        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          error: {
            message: error.message || 'Workflow execution failed',
            stackTrace: error.stack,
          },
          traceSpans,
        })

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
  requestId?: string
  executionId?: string
  triggerData?: Record<string, unknown>
  stream?: WorkflowStreamOptions
  contextExtensions?: Record<string, unknown>
}): Promise<WorkflowRunnerResult> {
  const blueprint = await loadWorkflowExecutionBlueprint({
    workflowId: params.workflowId,
    executionTarget: params.executionTarget,
    workflowContext: params.workflowContext,
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
    stream: params.stream,
    contextExtensions: params.contextExtensions,
  })
}
