import { v4 as uuidv4 } from 'uuid'
import { isPendingWorkflowExecutionCancellationRequested } from '@/lib/execution/pending-execution'
import { createWorkflowExecutionEventWriter } from '@/lib/execution/workflow-execution-events'
import type { AttemptTimeBudget } from '@/lib/execution/workflow-execution-time-budget'
import {
  isWorkflowExecutionTimePolicy,
  type WorkflowExecutionTimePolicy,
} from '@/lib/execution/workflow-execution-time-policy'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getMonitorProviderForTriggerId, isMonitorTriggerId } from '@/lib/monitors/sources'
import { createWorkflowExecutionTerminalEventInput } from '@/lib/workflows/execution-events'
import {
  runPreparedWorkflowExecution,
  runWorkflowExecution,
  type WorkflowExecutionBlueprint,
  type WorkflowTriggerTarget,
} from '@/lib/workflows/execution-runner'
import type { ExecutionResult } from '@/executor/types'
import type { TriggerType } from '@/services/queue'
import { disableMonitor } from './monitor-disable'

const logger = createLogger('TriggerWorkflowExecution')

type WorkflowTriggerTargetType = Extract<WorkflowTriggerTarget, { kind: 'trigger' }>['triggerType']

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  workspaceId?: string | null
  executionId?: string
  input?: any
  triggerType?: TriggerType
  triggerBlockId?: string
  executionTarget?: 'deployed' | 'live'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  workflowDepth?: number
  stream?: boolean
  selectedOutputs?: string[]
  triggerData?: Record<string, unknown>
  metadata?: Record<string, any>
}

export type WorkflowExecutionAttemptOptions = {
  attemptStartedAt: string
  timePolicy: WorkflowExecutionTimePolicy
  timeBudget: AttemptTimeBudget
  fallbackActorUserId: string
  fallbackWorkspaceId: string
}

type WorkflowExecutionJobResult = Pick<ExecutionResult, 'success' | 'output'> &
  Partial<Pick<ExecutionResult, 'error' | 'code' | 'deadline'>> & {
    workflowId: string
    executionId: string
    executedAt: string
  }

export type WorkflowExecutionJobPreparation =
  | {
      kind: 'execute'
      payload: WorkflowExecutionPayload
      blueprint: WorkflowExecutionBlueprint
      immediateResult?: ExecutionResult
    }
  | { kind: 'ignore' }

function resolveWorkflowTriggerTargetType(triggerType: TriggerType): WorkflowTriggerTargetType {
  if (triggerType === 'chat') return 'chat'
  if (triggerType === 'api' || triggerType === 'api-endpoint') return 'api'
  if (triggerType === 'manual') return 'manual'
  throw new Error(`Queued ${triggerType} workflow execution requires an explicit trigger block`)
}

export function isWorkflowExecutionPayload(
  value: unknown
): value is WorkflowExecutionPayload & Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.workflowId === 'string' && typeof candidate.userId === 'string'
}

async function executePreparedWorkflowJob(
  payload: WorkflowExecutionPayload,
  options: WorkflowExecutionAttemptOptions & {
    blueprint?: WorkflowExecutionBlueprint
    immediateResult?: ExecutionResult
  }
) {
  const workflowId = payload.workflowId
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  const isChildExecution = payload.metadata?.source === 'workflow_block'
  const eventWriterPromise =
    payload.stream === true || isChildExecution
      ? createWorkflowExecutionEventWriter({
          pendingExecutionId: executionId,
          workflowId,
        })
      : Promise.resolve(null)
  const executionTarget = payload.executionTarget ?? 'deployed'
  const isLiveExecution = executionTarget === 'live'
  const triggerType = payload.triggerType ?? 'manual'
  const triggerTarget: WorkflowTriggerTarget = payload.triggerBlockId
    ? {
        kind: 'block',
        blockId: payload.triggerBlockId,
      }
    : {
        kind: 'trigger',
        triggerType: resolveWorkflowTriggerTargetType(triggerType),
      }

  const processingStartedAt = options.attemptStartedAt
  const inheritedPolicy = isChildExecution ? payload.metadata?.timePolicy : undefined
  if (isChildExecution && !isWorkflowExecutionTimePolicy(inheritedPolicy)) {
    throw new Error('Nested workflow execution is missing its authenticated time policy')
  }
  if (!isWorkflowExecutionTimePolicy(options.timePolicy)) {
    throw new Error('Workflow execution is missing its captured time policy')
  }
  const timePolicy = isChildExecution ? inheritedPolicy! : options.timePolicy
  let eventWriter =
    timePolicy.kind === 'bounded'
      ? await Promise.race([eventWriterPromise, options.timeBudget.expired.then(() => null)])
      : await eventWriterPromise

  logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`, {
    userId: payload.userId,
    triggerType,
    executionId,
  })

  if (eventWriter) {
    const started = eventWriter.write({
      type: 'execution:started',
      data: {
        startTime: new Date().toISOString(),
      },
    })
    if (timePolicy.kind === 'bounded') {
      const completed = await Promise.race([
        started.then(() => true),
        options.timeBudget.expired.then(() => false),
      ])
      if (!completed) eventWriter = null
    } else {
      await started
    }
  }

  try {
    const triggerData =
      payload.metadata === undefined
        ? payload.triggerData
        : { ...(payload.triggerData ?? {}), queuedExecution: payload.metadata }
    const runner = options?.blueprint
      ? runPreparedWorkflowExecution({
          blueprint: options.blueprint,
          actorUserId: payload.userId,
          requestId,
          executionId,
          triggerType,
          workflowInput: payload.input ?? {},
          triggerTarget,
          triggerData,
          timePolicy,
          timeBudget: options.timeBudget,
          attemptStartedAt: processingStartedAt,
          preparedResult: options.immediateResult,
          contextExtensions: {
            workflowDepth: payload.workflowDepth ?? 0,
            isChildExecution,
            stream: payload.stream === true,
            selectedOutputs: payload.selectedOutputs ?? [],
            shouldCancelExecution: () =>
              isPendingWorkflowExecutionCancellationRequested(executionId),
          },
        })
      : runWorkflowExecution({
          workflowId,
          actorUserId: payload.userId,
          requestId,
          executionId,
          executionTarget,
          triggerType,
          workflowInput: payload.input ?? {},
          workflowContext:
            payload.workspaceId || (isLiveExecution && payload.workflowVariables)
              ? {
                  workspaceId: payload.workspaceId,
                  variables: isLiveExecution ? payload.workflowVariables : undefined,
                }
              : undefined,
          workflowData: isLiveExecution ? payload.workflowData : undefined,
          triggerTarget,
          triggerData,
          timePolicy,
          timeBudget: options.timeBudget,
          fallbackWorkspaceId: options.fallbackWorkspaceId,
          attemptStartedAt: processingStartedAt,
          contextExtensions: {
            workflowDepth: payload.workflowDepth ?? 0,
            isChildExecution,
            stream: payload.stream === true,
            selectedOutputs: payload.selectedOutputs ?? [],
            shouldCancelExecution: () =>
              isPendingWorkflowExecutionCancellationRequested(executionId),
            ...(payload.stream === true && eventWriter
              ? {
                  onExecutionEvent: async (event) => {
                    await eventWriter.write(event)
                  },
                }
              : {}),
          },
        })
    const { result, dispatchFailureReason } = await runner
    if (dispatchFailureReason && isMonitorTriggerId(triggerData?.source)) {
      const monitorId = (triggerData.monitor as { id?: unknown } | null | undefined)?.id
      if (typeof monitorId === 'string') {
        await disableMonitor({
          monitorId,
          provider: getMonitorProviderForTriggerId(triggerData.source),
          logger,
          reason: dispatchFailureReason,
          workflowId,
        })
      }
    }

    const { traceSpans } = buildTraceSpans(result)
    const queuedResult = {
      ...result,
      success: result.success,
      workflowId: payload.workflowId,
      executionId,
      output: result.output,
      error: result.error,
      traceSpans: traceSpans || [],
      executedAt: new Date().toISOString(),
      metadata: {
        ...(result.metadata ?? {}),
        queuedExecution: payload.metadata,
      },
    }

    await eventWriter?.write(createWorkflowExecutionTerminalEventInput(queuedResult))

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return queuedResult
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow execution failed'
    await eventWriter?.write(
      createWorkflowExecutionTerminalEventInput({
        success: false,
        output: {},
        error: message,
        logs: [],
      })
    )
    throw error
  }
}

export function executeWorkflowJob(
  payload: WorkflowExecutionPayload,
  options: WorkflowExecutionAttemptOptions & { blueprint?: WorkflowExecutionBlueprint }
): Promise<WorkflowExecutionJobResult>
export function executeWorkflowJob(
  payload: WorkflowExecutionPayload,
  options: WorkflowExecutionAttemptOptions & { blueprint?: WorkflowExecutionBlueprint },
  prepare: () => Promise<WorkflowExecutionJobPreparation>
): Promise<WorkflowExecutionJobResult | undefined>
export async function executeWorkflowJob(
  payload: WorkflowExecutionPayload,
  options: WorkflowExecutionAttemptOptions & { blueprint?: WorkflowExecutionBlueprint },
  prepare?: () => Promise<WorkflowExecutionJobPreparation>
) {
  if (!prepare) return executePreparedWorkflowJob(payload, options)

  let execution: Promise<WorkflowExecutionJobResult | undefined> | undefined
  const run = (prepared: WorkflowExecutionJobPreparation) => {
    if (execution) return execution
    if (prepared.kind === 'ignore') execution = Promise.resolve(undefined)
    else {
      execution = executePreparedWorkflowJob(prepared.payload, {
        ...options,
        blueprint: prepared.blueprint,
        immediateResult: prepared.immediateResult,
      })
    }
    return execution
  }

  const preparation = prepare()
  if (options.timePolicy.kind === 'unlimited') return run(await preparation)

  const deadline = options.timeBudget.expired.then(() =>
    run({
      kind: 'execute',
      payload: {
        ...payload,
        userId: options.fallbackActorUserId,
        workspaceId: options.fallbackWorkspaceId,
      },
      blueprint: {
        workflowId: payload.workflowId,
        executionTarget: payload.executionTarget ?? 'deployed',
        workflowContext: { workspaceId: options.fallbackWorkspaceId, variables: null },
        workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
      },
    })
  )
  const prepared = preparation.then((value) =>
    (options.timeBudget.remainingMilliseconds() ?? 0) <= 0 ? deadline : run(value)
  )
  return Promise.race([prepared, deadline])
}
