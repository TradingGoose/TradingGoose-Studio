import { db } from '@tradinggoose/db'
import { workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { setWorkflowExecutionParticipantState } from '@/lib/execution/workflow-execution-deadline-repository'
import {
  claimWorkflowOperationRemoteDispatch,
  completeWorkflowExecutionAttempt,
  completeWorkflowOperation,
  finalizeWorkflowExecution,
  getWorkflowOperationCapability,
  publishWorkflowOperationIdentity,
  registerWorkflowOperation,
  sealWorkflowOperationCredential,
  type WorkflowExecutionLifecycle,
  type WorkflowExecutionOperationHandle,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import type { WorkflowExecutionRuntime } from '@/lib/execution/workflow-execution-runtime'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
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
  lifecycle?: WorkflowExecutionLifecycle
  deadlineRuntime: WorkflowExecutionRuntime
  prepareWorkflowInput?: (context: {
    blueprint: WorkflowExecutionBlueprint
    signal?: AbortSignal
  }) => Promise<
    { kind: 'execute'; workflowInput: unknown } | { kind: 'skip'; result: ExecutionResult }
  >
}): Promise<WorkflowRunnerResult> {
  const executionId = params.executionId ?? uuidv4()
  const requestId = params.requestId ?? executionId.slice(0, 8)
  const workspaceId = params.blueprint.workflowContext.workspaceId
  if (!params.lifecycle) {
    throw new Error(`Workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const lifecycle = params.lifecycle
  const deadlineRuntime = params.deadlineRuntime
  const loggingTriggerType = params.triggerType === 'api-endpoint' ? 'api' : params.triggerType
  const loggingSession = new LoggingSession(
    params.blueprint.workflowId,
    executionId,
    loggingTriggerType,
    requestId
  )
  let encryptedEnvVars: Record<string, string> | undefined
  let result: ExecutionResult
  try {
    deadlineRuntime.signal?.throwIfAborted()

    // Workflow logs are the durable terminal state for queued and non-stream executions.
    const workflowLogId = await loggingSession.start({
      userId: params.actorUserId,
      workspaceId,
      workflowState: params.blueprint.workflowData,
      triggerData: params.triggerData,
    })
    deadlineRuntime.signal?.throwIfAborted()
    if (params.startupError) {
      throw params.startupError
    }

    const usageCheck = await checkServerSideUsageLimits({
      userId: params.actorUserId,
      workflowId: params.blueprint.workflowId,
      workspaceId,
    })
    deadlineRuntime.signal?.throwIfAborted()

    if (usageCheck.isExceeded) {
      throw new WorkflowUsageLimitError(
        usageCheck.message || 'Usage limit exceeded. Please upgrade your billing tier to continue.'
      )
    }

    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      params.actorUserId,
      workspaceId
    )
    deadlineRuntime.signal?.throwIfAborted()
    encryptedEnvVars = {
      ...personalEncrypted,
      ...workspaceEncrypted,
    }
    const decryptedEnvVars = await decryptEnvironmentVariables(encryptedEnvVars)
    deadlineRuntime.signal?.throwIfAborted()
    const mergedStates = mergeSubblockState(params.blueprint.workflowData.blocks, {})
    deadlineRuntime.signal?.throwIfAborted()
    const processedBlockStates = buildProcessedBlockStates(mergedStates, decryptedEnvVars)
    deadlineRuntime.signal?.throwIfAborted()
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      params.blueprint.workflowData.edges,
      params.blueprint.workflowData.loops,
      params.blueprint.workflowData.parallels,
      true
    )
    deadlineRuntime.signal?.throwIfAborted()
    const workflowVariables = normalizeVariables(params.blueprint.workflowContext.variables)
    deadlineRuntime.signal?.throwIfAborted()

    const operationWaitStates = new Map<string, 'active' | 'waiting_child'>()
    const operationHandles = new Map<string, WorkflowExecutionOperationHandle>()
    const settledOperationIds = new Set<string>()
    let waitTransitionQueue = Promise.resolve()
    let participantWaiting = false
    const updateOperationWaitState = async (
      operationId: string,
      state: 'active' | 'waiting_child' | 'completed'
    ) => {
      const transition = waitTransitionQueue.then(async () => {
        if (state === 'completed') operationWaitStates.delete(operationId)
        else operationWaitStates.set(operationId, state)
        const nextWaiting =
          operationWaitStates.size > 0 &&
          [...operationWaitStates.values()].every((value) => value === 'waiting_child')
        if (nextWaiting !== participantWaiting && lifecycle.participantId) {
          const reconciliation = await setWorkflowExecutionParticipantState({
            rootExecutionId: lifecycle.policy.rootExecutionId,
            attemptId: lifecycle.attemptId,
            participantId: lifecycle.participantId,
            state: nextWaiting ? 'waiting_child' : 'active',
          })
          if (
            !reconciliation ||
            reconciliation.state === 'closed' ||
            reconciliation.state === 'exhausted'
          ) {
            throw new Error('Workflow participant transition was rejected')
          }
          participantWaiting = nextWaiting
          await deadlineRuntime.rearm()
        }
      })
      waitTransitionQueue = transition.catch(() => undefined)
      return transition
    }
    const contextExtensions: ExecutionContextExtensions = {
      ...params.contextExtensions,
      executionId,
      workspaceId,
      userId: params.actorUserId,
      isDeployedContext: params.blueprint.executionTarget !== 'live',
      triggerType: params.triggerType,
      workflowDepth: params.contextExtensions?.workflowDepth ?? 0,
      submissionSource: 'workflow',
      workflowLogId,
      workflowExecutionTimePolicy: lifecycle.policy,
      workflowDeadlineSignal: deadlineRuntime.signal,
      registerWorkflowOperation: async (blockId, handlerType) => {
        const operation = await registerWorkflowOperation({
          rootExecutionId: lifecycle.policy.rootExecutionId,
          executionId,
          attemptId: lifecycle.attemptId,
          participantId: lifecycle.participantId,
          blockId,
          handlerType,
          adapterKind: handlerType,
          capability: getWorkflowOperationCapability(handlerType),
        })
        operationHandles.set(operation.id, {
          id: operation.id,
          rootExecutionId: operation.rootExecutionId,
          attemptId: operation.attemptId,
          participantId: operation.participantId ?? undefined,
        })
        await updateOperationWaitState(operation.id, 'active')
        return operation.id
      },
      completeWorkflowOperation: async (id, state, observation) => {
        const operation = operationHandles.get(id)
        if (!operation) {
          if (settledOperationIds.has(id)) return
          throw new Error(`Unknown workflow operation ${id}`)
        }
        const completed = await completeWorkflowOperation({ operation, state, observation })
        if (!completed) throw new Error('Workflow operation completion was rejected')
        await updateOperationWaitState(id, 'completed')
        operationHandles.delete(id)
        settledOperationIds.add(id)
      },
      publishWorkflowOperationIdentity: async (id, identity) => {
        const operation = operationHandles.get(id)
        if (!operation) throw new Error(`Unknown workflow operation ${id}`)
        const published = await publishWorkflowOperationIdentity({ operation, ...identity })
        if (!published) throw new Error('Workflow operation identity was rejected')
      },
      claimWorkflowOperationRemoteDispatch: async (id) => {
        const operation = operationHandles.get(id)
        return operation ? claimWorkflowOperationRemoteDispatch(operation) : false
      },
      prepareWorkflowOperationCredential: async (id, secret) => {
        const operation = operationHandles.get(id)
        if (!operation) throw new Error(`Unknown workflow operation ${id}`)
        const { encryptSecret } = await import('@/lib/utils-server')
        const { encrypted } = await encryptSecret(secret)
        const sealed = await sealWorkflowOperationCredential(operation, encrypted)
        if (!sealed) throw new Error('Workflow operation credential was rejected')
      },
      setWorkflowParticipantWaiting: lifecycle.participantId
        ? async (operationId, waiting) => {
            if (!operationWaitStates.has(operationId)) {
              throw new Error(`Unknown workflow operation ${operationId}`)
            }
            await updateOperationWaitState(operationId, waiting ? 'waiting_child' : 'active')
          }
        : undefined,
    }

    if (contextExtensions.stream) {
      contextExtensions.edges = params.blueprint.workflowData.edges.map((edge: any) => ({
        source: edge.source,
        target: edge.target,
      }))
    }

    let workflowInput = params.workflowInput
    let preparedResult: ExecutionResult | undefined
    if (params.prepareWorkflowInput) {
      try {
        const prepared = await params.prepareWorkflowInput({
          blueprint: params.blueprint,
          signal: deadlineRuntime.signal,
        })
        deadlineRuntime.signal?.throwIfAborted()
        if (prepared.kind === 'skip') preparedResult = prepared.result
        else workflowInput = prepared.workflowInput
      } catch (error) {
        preparedResult = {
          success: false,
          output: {},
          error: error instanceof Error ? error.message : String(error),
          logs: [],
        }
      }
    }

    await deadlineRuntime.settleStartup('completed')
    deadlineRuntime.signal?.throwIfAborted()

    if (preparedResult) {
      result = preparedResult
    } else {
      const executor = new Executor({
        workflow: serializedWorkflow,
        currentBlockStates: processedBlockStates,
        envVarValues: decryptedEnvVars,
        workflowInput,
        workflowVariables,
        contextExtensions,
      })
      const triggerBlockId = resolveTriggerBlockId({
        mergedStates,
        serializedWorkflow,
        target: params.triggerTarget,
        isChildExecution: contextExtensions.isChildExecution === true,
      })
      result = await executor.execute(params.blueprint.workflowId, triggerBlockId)
    }
    if (lifecycle.isRoot) {
      const storedResult = await finalizeWorkflowExecution({
        rootExecutionId: executionId,
        attemptId: lifecycle.attemptId,
        result,
      })
      if (!storedResult) {
        throw new Error(`Workflow execution ${executionId} is awaiting termination reconciliation`)
      }
      result = storedResult
    } else {
      await completeWorkflowExecutionAttempt({
        attemptId: lifecycle.attemptId,
        result,
      })
    }

    if (result.success) {
      await updateWorkflowRunCounts(params.blueprint.workflowId).catch((error) =>
        logger.error(`[${requestId}] Workflow run count update failed after execution`, error)
      )
    }
  } catch (error: any) {
    const deadlineAborted = deadlineRuntime.signal?.aborted === true
    await deadlineRuntime.settleStartup(deadlineAborted ? 'local_abort' : 'failed')
    const isApplicationFailure =
      deadlineAborted ||
      error instanceof WorkflowUsageLimitError ||
      error instanceof WorkflowTriggerBlockError ||
      Boolean(error?.executionResult)
    if (!isApplicationFailure) throw error
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
    if (lifecycle.isRoot) {
      const storedResult = await finalizeWorkflowExecution({
        rootExecutionId: lifecycle.policy.rootExecutionId,
        attemptId: lifecycle.attemptId,
        result,
      })
      if (!storedResult) {
        throw new Error(
          `Workflow execution ${lifecycle.policy.rootExecutionId} is awaiting termination reconciliation`
        )
      }
      result = storedResult
    } else {
      await completeWorkflowExecutionAttempt({
        attemptId: lifecycle.attemptId,
        result,
      })
    }
    return {
      executionId,
      result,
      workflowData: params.blueprint.workflowData,
      workspaceId,
      dispatchFailureReason,
    }
  }

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
  lifecycle?: WorkflowExecutionLifecycle
  deadlineRuntime: WorkflowExecutionRuntime
}): Promise<WorkflowRunnerResult> {
  params.deadlineRuntime.signal?.throwIfAborted()
  let startupError: unknown
  const blueprint = await loadWorkflowExecutionBlueprint({
    workflowId: params.workflowId,
    executionTarget: params.executionTarget,
    workflowContext: params.workflowContext,
    workflowData: params.workflowData,
  }).catch(async (error) => {
    params.deadlineRuntime.signal?.throwIfAborted()
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
  params.deadlineRuntime.signal?.throwIfAborted()

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
    lifecycle: params.lifecycle,
    deadlineRuntime: params.deadlineRuntime,
  })
}
