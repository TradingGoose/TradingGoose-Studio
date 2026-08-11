import { db } from '@tradinggoose/db'
import { workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createWorkflowExecutionResultDiagnostics } from '@/lib/execution/workflow-execution-diagnostics'
import type { AttemptTimeBudget } from '@/lib/execution/workflow-execution-time-budget'
import {
  createWorkflowExecutionDeadlineResult,
  WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED,
  type WorkflowExecutionTimePolicy,
} from '@/lib/execution/workflow-execution-time-policy'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils-server'
import { loadDeployedWorkflowState, requireWorkflowRealtimeState } from '@/lib/workflows/db-helpers'
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

export type WorkflowRunnerExecutionResult = ExecutionResult
export type WorkflowDispatchFailureReason = 'usage_limit_exceeded' | 'missing_trigger_block'

export type WorkflowRunnerResult = {
  executionId: string
  result: WorkflowRunnerExecutionResult
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
  preparedResult?: ExecutionResult
  timePolicy: WorkflowExecutionTimePolicy
  timeBudget: AttemptTimeBudget
  attemptStartedAt: string
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
  let encryptedEnvVars: Record<string, string> | undefined
  let result: ExecutionResult
  let executor: Executor | undefined
  let workflowLogId: string | undefined
  const executionPolicy = params.timePolicy
  const timeBudget = params.timeBudget
  const carriesChildRemainingBudget =
    params.contextExtensions?.isChildExecution === true &&
    executionPolicy.kind === 'bounded' &&
    executionPolicy.accounting.mode === 'remaining'
  const attachChildRemainingBudget = (executionResult: ExecutionResult) => {
    if (carriesChildRemainingBudget) {
      executionResult.remainingMilliseconds = timeBudget.remainingMilliseconds() ?? 0
    }
  }
  let deadlineResult: ExecutionResult | undefined
  const closeForDeadline = (
    boundedPolicy: Extract<WorkflowExecutionTimePolicy, { kind: 'bounded' }>
  ) => {
    if (deadlineResult) return deadlineResult
    executor?.stopForDeadline()
    const terminatedAt = new Date().toISOString()
    deadlineResult = createWorkflowExecutionDeadlineResult(
      boundedPolicy,
      terminatedAt,
      executor?.snapshotBlockLogsForDeadline(terminatedAt) ?? []
    )
    return deadlineResult
  }
  const deadlineResultIfExpired = () => {
    if (deadlineResult) return deadlineResult
    if (executionPolicy.kind !== 'bounded' || (timeBudget.remainingMilliseconds() ?? 0) > 0) {
      return null
    }
    return closeForDeadline(executionPolicy)
  }

  // Workflow logs are the durable terminal state for queued and non-stream executions.
  const loggingStart = loggingSession.start({
    userId: params.actorUserId,
    workspaceId,
    workflowState: params.blueprint.workflowData,
    triggerData: params.triggerData,
    startedAt: params.attemptStartedAt,
  })
  try {
    const attempt = (async (): Promise<ExecutionResult> => {
      workflowLogId = await loggingStart
      const expiredAfterLoggingStart = deadlineResultIfExpired()
      if (expiredAfterLoggingStart) return expiredAfterLoggingStart
      if (params.preparedResult) return params.preparedResult
      if (params.startupError) throw params.startupError

      const usageCheck = await checkServerSideUsageLimits({
        userId: params.actorUserId,
        workflowId: params.blueprint.workflowId,
        workspaceId,
      })
      const expiredAfterUsage = deadlineResultIfExpired()
      if (expiredAfterUsage) return expiredAfterUsage
      if (usageCheck.isExceeded) {
        throw new WorkflowUsageLimitError(
          usageCheck.message ||
            'Usage limit exceeded. Please upgrade your billing tier to continue.'
        )
      }

      const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
        params.actorUserId,
        workspaceId
      )
      const expiredAfterEnvironmentLoad = deadlineResultIfExpired()
      if (expiredAfterEnvironmentLoad) return expiredAfterEnvironmentLoad
      encryptedEnvVars = { ...personalEncrypted, ...workspaceEncrypted }
      const decryptedEnvVars = await decryptEnvironmentVariables(encryptedEnvVars)
      const expiredAfterDecryption = deadlineResultIfExpired()
      if (expiredAfterDecryption) return expiredAfterDecryption

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
      const expiredAfterSerialization = deadlineResultIfExpired()
      if (expiredAfterSerialization) return expiredAfterSerialization

      const contextExtensions: ExecutionContextExtensions = {
        ...params.contextExtensions,
        workflowExecutionTimeBudget: timeBudget,
        executionId,
        workspaceId,
        userId: params.actorUserId,
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

      executor = new Executor({
        workflow: serializedWorkflow,
        currentBlockStates: processedBlockStates,
        envVarValues: decryptedEnvVars,
        workflowInput: params.workflowInput,
        workflowVariables,
        contextExtensions,
      })
      const triggerBlockId = resolveTriggerBlockId({
        mergedStates,
        serializedWorkflow,
        target: params.triggerTarget,
        isChildExecution: contextExtensions.isChildExecution === true,
      })
      const expiredBeforeDispatch = deadlineResultIfExpired()
      if (expiredBeforeDispatch) {
        return expiredBeforeDispatch
      }
      return executor.execute(params.blueprint.workflowId, triggerBlockId)
    })()

    if (executionPolicy.kind === 'bounded') {
      const deadline = timeBudget.expired.then(() => closeForDeadline(executionPolicy))
      result = await Promise.race([attempt, deadline])
      void attempt.catch(() => undefined)
    } else {
      result = await attempt
    }
    attachChildRemainingBudget(result)
    if (result.success) {
      await updateWorkflowRunCounts(params.blueprint.workflowId).catch((error) =>
        logger.error(`[${requestId}] Workflow run count update failed after execution`, error)
      )
    }
  } catch (error: any) {
    if (!workflowLogId) throw error
    const message = error.message || 'Workflow execution failed'
    const dispatchFailureReason =
      error instanceof WorkflowUsageLimitError
        ? 'usage_limit_exceeded'
        : error instanceof WorkflowTriggerBlockError
          ? 'missing_trigger_block'
          : undefined
    result = (error?.executionResult as ExecutionResult | undefined) || {
      success: false,
      output: {},
      error: message,
      logs: [],
    }
    attachChildRemainingBudget(result)
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    await loggingSession.completeWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      error: {
        message,
        stackTrace: error.stack,
      },
      traceSpans,
      workspaceId,
      actorUserId: params.actorUserId,
      variables: encryptedEnvVars,
      result: createWorkflowExecutionResultDiagnostics(result),
    })
    return {
      executionId,
      result,
      workflowData: params.blueprint.workflowData,
      workspaceId,
      dispatchFailureReason,
    }
  }

  if (result === deadlineResult) {
    await loggingStart
  }
  const { traceSpans, totalDuration } = buildTraceSpans(result)
  await loggingSession.complete({
    endedAt:
      result.code === WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED
        ? result.deadline?.terminatedAt
        : new Date().toISOString(),
    totalDurationMs: totalDuration || 0,
    finalOutput: result.output === undefined ? {} : result.output,
    success: result.success,
    failureReason: result.error,
    traceSpans: traceSpans || [],
    workflowInput: params.workflowInput,
    workspaceId,
    actorUserId: params.actorUserId,
    hasResponseBlock:
      result.logs?.some((log) => log.success && log.blockType === 'response') === true,
    variables: encryptedEnvVars,
    result: createWorkflowExecutionResultDiagnostics(result),
  })

  return {
    executionId,
    result,
    workflowData: params.blueprint.workflowData,
    workspaceId,
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
  timePolicy: WorkflowExecutionTimePolicy
  timeBudget: AttemptTimeBudget
  fallbackWorkspaceId: string
  attemptStartedAt: string
}): Promise<WorkflowRunnerResult> {
  const preparation = loadWorkflowExecutionBlueprint({
    workflowId: params.workflowId,
    executionTarget: params.executionTarget,
    workflowContext: params.workflowContext,
    workflowData: params.workflowData,
  })
    .then((blueprint) => ({ blueprint, startupError: undefined as unknown }))
    .catch(async (startupError) => ({
      startupError,
      blueprint: {
        workflowId: params.workflowId,
        executionTarget: params.executionTarget ?? 'deployed',
        workflowContext: await resolveRequiredWorkflowExecutionContext(
          params.workflowId,
          params.workflowContext
        ),
        workflowData: params.workflowData ?? { blocks: {}, edges: [], loops: {}, parallels: {} },
      },
    }))
  let runner: Promise<WorkflowRunnerResult> | undefined
  const runPrepared = (prepared: {
    blueprint: WorkflowExecutionBlueprint
    startupError?: unknown
  }) => {
    runner ??= runPreparedWorkflowExecution({
      blueprint: prepared.blueprint,
      actorUserId: params.actorUserId,
      triggerType: params.triggerType,
      workflowInput: params.workflowInput,
      triggerTarget: params.triggerTarget,
      requestId: params.requestId,
      executionId: params.executionId,
      triggerData: params.triggerData,
      contextExtensions: params.contextExtensions,
      timePolicy: params.timePolicy,
      timeBudget: params.timeBudget,
      attemptStartedAt: params.attemptStartedAt,
      startupError: prepared.startupError,
    })
    return runner
  }

  if (params.timePolicy.kind === 'unlimited') {
    return runPrepared(await preparation)
  }

  const deadline = params.timeBudget.expired.then(() =>
    runPrepared({
      blueprint: {
        workflowId: params.workflowId,
        executionTarget: params.executionTarget ?? 'deployed',
        workflowContext: { workspaceId: params.fallbackWorkspaceId, variables: null },
        workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
      },
    })
  )
  const prepared = preparation.then((value) =>
    (params.timeBudget.remainingMilliseconds() ?? 0) <= 0 ? deadline : runPrepared(value)
  )
  return Promise.race([prepared, deadline])
}
