import { db } from '@tradinggoose/db'
import { workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils-server'
import { loadDeployedWorkflowState, requireWorkflowRealtimeState } from '@/lib/workflows/db-helpers'
import { workflowPauseLinks } from '@/lib/workflows/human-in-the-loop/links'
import { dispatchWorkflowPauseNotifications } from '@/lib/workflows/human-in-the-loop/notifications'
import {
  completeWorkflowCheckpointChild,
  saveWorkflowCheckpoint,
} from '@/lib/workflows/human-in-the-loop/service'
import type {
  WorkflowCheckpointSnapshot,
  WorkflowPausePoint,
} from '@/lib/workflows/human-in-the-loop/types'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { normalizeVariables } from '@/lib/workflows/variable-utils'
import { Executor } from '@/executor'
import type { ExecutionContextExtensions, ExecutionResult } from '@/executor/types'
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

export type WorkflowTriggerTarget =
  | {
      kind: 'trigger'
      triggerType: 'api' | 'chat' | 'manual'
    }
  | {
      kind: 'block'
      blockId: string
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

export type WorkflowDispatchFailureReason = 'usage_limit_exceeded' | 'missing_trigger_block'

export type WorkflowRunnerResult = {
  executionId: string
  result: ExecutionResult
  workflowData: WorkflowExecutionBlueprint['workflowData']
  workspaceId: string
  dispatchFailureReason?: WorkflowDispatchFailureReason
}

export class WorkflowUsageLimitError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 402) {
    super(message)
    this.name = 'WorkflowUsageLimitError'
    this.statusCode = statusCode
  }
}

class WorkflowTriggerBlockError extends Error {}

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
        variables?: unknown
      }
    | undefined

  if (needsWorkflowRecord) {
    if (workflowContext?.variables === undefined) {
      ;[workflowRecord] = await db
        .select({
          workspaceId: workflowTable.workspaceId,
          variables: workflowTable.variables,
        })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
    } else {
      ;[workflowRecord] = await db
        .select({ workspaceId: workflowTable.workspaceId })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
    }
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

function resolveTriggerBlockId(params: {
  mergedStates: Record<string, any>
  serializedWorkflow: { connections: Array<{ source: string }> }
  target: WorkflowTriggerTarget
  isChildExecution: boolean
}) {
  if (params.target.kind === 'trigger') {
    const triggerBlock = TriggerUtils.findTriggerBlock(
      params.mergedStates,
      params.target.triggerType,
      params.isChildExecution
    )

    if (!triggerBlock) {
      const triggerName =
        params.target.triggerType === 'api' && params.isChildExecution
          ? 'Input'
          : params.target.triggerType === 'api'
            ? 'API'
            : params.target.triggerType === 'chat'
              ? 'Chat'
              : 'Manual'
      throw new WorkflowTriggerBlockError(
        `No ${triggerName} trigger block found. Add a ${triggerName} Trigger block to this workflow.`
      )
    }

    const outgoingConnections = params.serializedWorkflow.connections.filter(
      (connection) => connection.source === triggerBlock.blockId
    )

    if (outgoingConnections.length === 0) {
      throw new WorkflowTriggerBlockError(
        'Trigger block must be connected to other blocks to execute'
      )
    }

    return triggerBlock.blockId
  }

  if (params.target.kind === 'block' && !params.mergedStates[params.target.blockId]) {
    throw new WorkflowTriggerBlockError(
      `Workflow does not contain trigger block ${params.target.blockId}`
    )
  }

  if (params.target.kind === 'block') {
    const blockId = params.target.blockId
    const outgoingConnections = params.serializedWorkflow.connections.filter(
      (connection) => connection.source === blockId
    )

    if (outgoingConnections.length === 0) {
      throw new WorkflowTriggerBlockError(
        `Trigger block ${blockId} must be connected to other blocks to execute`
      )
    }
  }

  return params.target.blockId
}

export async function loadWorkflowExecutionBlueprint(params: {
  workflowId: string
  executionTarget?: WorkflowExecutionTarget
  workflowContext?: WorkflowContextHint
  workflowData?: WorkflowExecutionBlueprint['workflowData']
}): Promise<WorkflowExecutionBlueprint> {
  const executionTarget = params.executionTarget ?? 'deployed'
  const liveWorkflowState =
    executionTarget === 'live' && !params.workflowData
      ? await requireWorkflowRealtimeState(params.workflowId)
      : null
  const workflowContext = await resolveRequiredWorkflowExecutionContext(
    params.workflowId,
    executionTarget === 'deployed'
      ? { ...params.workflowContext, variables: {} }
      : executionTarget === 'live' &&
          liveWorkflowState &&
          params.workflowContext?.variables === undefined
        ? {
            ...params.workflowContext,
            variables: liveWorkflowState.variables,
          }
        : params.workflowContext
  )
  const workflowData =
    executionTarget === 'live'
      ? (params.workflowData ?? liveWorkflowState)
      : await loadDeployedWorkflowState(params.workflowId)

  if (!workflowData) {
    throw new Error(`Workflow ${params.workflowId} has no ${executionTarget} state`)
  }

  const deployedVariables =
    executionTarget === 'deployed'
      ? ((workflowData as { variables?: Record<string, any> }).variables ?? {})
      : null

  return {
    workflowId: params.workflowId,
    executionTarget,
    workflowContext:
      executionTarget === 'deployed'
        ? { ...workflowContext, variables: deployedVariables }
        : workflowContext,
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
  triggerTarget: WorkflowTriggerTarget
  requestId?: string
  executionId?: string
  triggerData?: Record<string, unknown>
  contextExtensions?: Partial<ExecutionContextExtensions>
  startupError?: unknown
  resume?: { snapshot: WorkflowCheckpointSnapshot; pausePoints: WorkflowPausePoint[] }
}): Promise<WorkflowRunnerResult> {
  const executionId = params.executionId ?? uuidv4()
  const requestId = params.requestId ?? executionId.slice(0, 8)
  const workspaceId = params.blueprint.workflowContext.workspaceId
  const loggingTriggerType = params.triggerType === 'api-endpoint' ? 'api' : params.triggerType
  const loggingSession = new LoggingSession(
    params.blueprint.workflowId,
    executionId,
    loggingTriggerType,
    requestId,
    params.resume?.snapshot.workflowLogId
  )

  // Workflow logs are the durable terminal state for queued and non-stream executions.
  const workflowLogId =
    params.resume?.snapshot.workflowLogId ??
    (await loggingSession.start({
      userId: params.actorUserId,
      workspaceId,
      workflowState: params.blueprint.workflowData,
      triggerData: params.triggerData,
    }))

  let encryptedEnvVars: Record<string, string> | undefined
  const isChildExecution =
    params.contextExtensions?.isChildExecution === true ||
    (params.resume?.snapshot.executor.context.workflowDepth ?? 0) > 0
  let result: ExecutionResult = {
    success: false,
    output: {},
    logs: params.resume?.snapshot.executor.context.blockLogs ?? [],
    metadata: params.resume?.snapshot.executor.context.metadata ?? { duration: 0 },
  }
  let dispatchFailureReason: WorkflowDispatchFailureReason | undefined
  try {
    if (params.startupError) {
      throw params.startupError
    }

    const usageCheck = await checkServerSideUsageLimits({
      userId: params.actorUserId,
      workflowId: params.blueprint.workflowId,
      workspaceId,
    })

    if (usageCheck.isExceeded) {
      throw new WorkflowUsageLimitError(
        usageCheck.message || 'Usage limit exceeded. Please upgrade your billing tier to continue.'
      )
    }

    if (params.resume) {
      encryptedEnvVars = params.resume.snapshot.encryptedEnvVars ?? {}
    } else {
      const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
        params.actorUserId,
        workspaceId
      )
      encryptedEnvVars = { ...personalEncrypted, ...workspaceEncrypted }
    }
    const checkpoint = params.resume?.snapshot.executor
    const decryptedEnvVars =
      checkpoint?.context.environmentVariables ??
      (await decryptEnvironmentVariables(encryptedEnvVars))
    const mergedStates = mergeSubblockState(params.blueprint.workflowData.blocks, {})
    const processedBlockStates =
      checkpoint?.currentBlockStates ?? buildProcessedBlockStates(mergedStates, decryptedEnvVars)
    const serializedWorkflow =
      checkpoint?.workflow ??
      new Serializer().serializeWorkflow(
        mergedStates,
        params.blueprint.workflowData.edges,
        params.blueprint.workflowData.loops,
        params.blueprint.workflowData.parallels,
        true
      )
    const workflowVariables =
      checkpoint?.context.workflowVariables ??
      normalizeVariables(params.blueprint.workflowContext.variables)

    const contextExtensions: ExecutionContextExtensions = {
      ...params.contextExtensions,
      executionId,
      workspaceId,
      userId: params.actorUserId,
      isDeployedContext: params.blueprint.executionTarget !== 'live',
      triggerType: params.triggerType,
      workflowDepth:
        checkpoint?.context.workflowDepth ?? params.contextExtensions?.workflowDepth ?? 0,
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
      checkpoint,
      resumeInputs:
        params.resume &&
        new Map(
          params.resume.pausePoints.map((point) => [
            point.id,
            {
              ...point.input,
              ...(point.kind === 'child' ? { childWorkflowName: point.childWorkflowName } : {}),
            },
          ])
        ),
    })

    const triggerBlockId =
      checkpoint?.context.triggerBlockId ??
      resolveTriggerBlockId({
        mergedStates,
        serializedWorkflow,
        target: params.triggerTarget,
        isChildExecution: contextExtensions.isChildExecution === true,
      })

    result = await executor.execute(params.blueprint.workflowId, triggerBlockId)

    if (result.status === 'paused' && (!result.checkpoint || !result.pausePoints?.length)) {
      throw new Error('Paused execution is missing its durable checkpoint')
    }

    if (result.status === 'paused' && result.checkpoint && result.pausePoints) {
      const { checkpoint: nextCheckpoint, pausePoints, ...publicResult } = result
      const saved = await saveWorkflowCheckpoint({
        executionId,
        pendingExecutionId: contextExtensions.pendingExecutionId,
        workflowId: params.blueprint.workflowId,
        workspaceId,
        userId: params.actorUserId,
        pausePoints,
        snapshot: {
          executor: nextCheckpoint,
          blueprint: params.blueprint,
          workflowInput: params.workflowInput,
          triggerType: params.triggerType,
          triggerData: params.triggerData,
          workflowLogId,
          encryptedEnvVars,
        },
      })
      result = {
        ...publicResult,
        output: {
          ...workflowPauseLinks(params.blueprint.workflowId, executionId),
          revision: saved.revision,
        },
      }
      await contextExtensions
        .onExecutionEvent?.({ type: 'execution:paused', data: { result } })
        .catch((error) => logger.error('Could not publish pause event; checkpoint is saved', error))
      await dispatchWorkflowPauseNotifications(nextCheckpoint, pausePoints).catch((error) =>
        logger.error('Could not dispatch notifications; checkpoint is saved', error)
      )
      return { executionId, result, workflowData: params.blueprint.workflowData, workspaceId }
    }

    if (result.success) {
      await updateWorkflowRunCounts(params.blueprint.workflowId).catch((error) =>
        logger.error(`[${requestId}] Workflow run count update failed after execution`, error)
      )
    }
  } catch (error: any) {
    const message = error.message || 'Workflow execution failed'
    dispatchFailureReason =
      error instanceof WorkflowUsageLimitError
        ? 'usage_limit_exceeded'
        : error instanceof WorkflowTriggerBlockError
          ? 'missing_trigger_block'
          : undefined
    result = {
      success: false,
      output: {},
      error: message,
      logs: result.logs,
      metadata: result.metadata,
    }
  }

  const { traceSpans } = buildTraceSpans(result)

  await loggingSession.complete({
    totalDurationMs: result.metadata?.duration ?? 0,
    finalOutput: result.output,
    success: result.success,
    failureReason: result.error,
    traceSpans,
    workflowInput: params.workflowInput,
    workspaceId,
    hasResponseBlock:
      result.logs?.some((log) => log.success && log.blockType === 'response') === true,
    variables: encryptedEnvVars,
  })

  if (!result.success) {
    const { cancelPendingExecutionDescendants } = await import(
      '@/background/pending-execution-worker'
    )
    await cancelPendingExecutionDescendants(executionId)
  }
  if (isChildExecution)
    await completeWorkflowCheckpointChild({
      childExecutionId: executionId,
      input: { ...result, traceSpans },
    })

  return {
    executionId,
    result,
    workflowData: params.blueprint.workflowData,
    workspaceId,
    dispatchFailureReason,
  }
}

export async function runWorkflowExecution(params: {
  workflowId: string
  actorUserId: string
  triggerType: TriggerType
  workflowInput: unknown
  triggerTarget: WorkflowTriggerTarget
  executionTarget?: WorkflowExecutionTarget
  workflowContext?: WorkflowContextHint
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  requestId?: string
  executionId?: string
  triggerData?: Record<string, unknown>
  contextExtensions?: Partial<ExecutionContextExtensions>
}): Promise<WorkflowRunnerResult> {
  let startupError: unknown
  const blueprint = await loadWorkflowExecutionBlueprint({
    workflowId: params.workflowId,
    executionTarget: params.executionTarget,
    workflowContext: params.workflowContext,
    workflowData: params.workflowData,
  }).catch(async (error) => {
    startupError = error
    return {
      workflowId: params.workflowId,
      executionTarget: params.executionTarget ?? 'deployed',
      workflowContext: await resolveRequiredWorkflowExecutionContext(
        params.workflowId,
        params.workflowContext
      ),
      workflowData: params.workflowData ?? { blocks: {}, edges: [], loops: {}, parallels: {} },
    }
  })

  return runPreparedWorkflowExecution({
    blueprint,
    actorUserId: params.actorUserId,
    triggerType: params.triggerType,
    workflowInput: params.workflowInput,
    triggerTarget: params.triggerTarget,
    requestId: params.requestId,
    executionId: params.executionId,
    triggerData: params.triggerData,
    contextExtensions: params.contextExtensions,
    startupError,
  })
}
