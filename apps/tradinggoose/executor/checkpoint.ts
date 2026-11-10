import { safeInferenceError } from '@/lib/mastra/errors'
import {
  getWorkflowMessageSource,
  workflowMemoryIdentity,
  workflowMessageDigest,
} from '@/lib/mastra/messages'
import { getInferenceFacts } from '@/lib/mastra/result'
import type { WorkflowMessageSource } from '@/lib/mastra/workflow-message-source'
import type { BlockOutput } from '@/blocks/types'
import {
  assertOccurrenceIds,
  type ExecutionContext,
  type NormalizedBlockOutput,
} from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

export type CheckpointMemorySources = {
  version: 2
  entries: Array<{ path: Array<string | number>; source: WorkflowMessageSource; digest: string }>
}

type MapEntries<T> = T extends Map<infer Key, infer Value> ? [Key, Value][] : never
type ParallelState = NonNullable<ExecutionContext['parallelExecutions']> extends Map<
  string,
  infer State
>
  ? State
  : never

type SavedContext = Omit<
  ExecutionContext,
  | 'workflow'
  | 'blockStates'
  | 'decisions'
  | 'loopIterations'
  | 'loopItems'
  | 'completedLoops'
  | 'executedBlocks'
  | 'activeExecutionPath'
  | 'loopExecutions'
  | 'parallelExecutions'
  | 'parallelBlockMapping'
  | 'onExecutionEvent'
  | 'pendingExecutionId'
  | 'shouldCancelExecution'
  | 'pausePoints'
  | 'resumeInputs'
> & {
  blockStates: MapEntries<ExecutionContext['blockStates']>
  decisions: {
    router: MapEntries<ExecutionContext['decisions']['router']>
    condition: MapEntries<ExecutionContext['decisions']['condition']>
  }
  loopIterations: MapEntries<ExecutionContext['loopIterations']>
  loopItems: MapEntries<ExecutionContext['loopItems']>
  completedLoops: string[]
  executedBlocks: string[]
  activeExecutionPath: string[]
  loopExecutions?: [string, [string, unknown][]][]
  parallelExecutions?: [
    string,
    Omit<ParallelState, 'executionResults' | 'activeIterations'> & {
      executionResults: [string, unknown][]
      activeIterations: number[]
    },
  ][]
  parallelBlockMapping?: MapEntries<NonNullable<ExecutionContext['parallelBlockMapping']>>
  workflowMemorySources?: CheckpointMemorySources
}

/** Internal, encrypted at rest. Never include this in public execution results or events. */
export type ExecutorCheckpoint = {
  workflow: SerializedWorkflow
  currentBlockStates: Record<string, BlockOutput>
  context: SavedContext
  iteration: number
  finalOutput: NormalizedBlockOutput
  workflowMemorySources?: CheckpointMemorySources
}

const NATIVE_REPORT_FIELDS = new Set([
  'tokens',
  'cost',
  'toolCost',
  'unavailableToolCosts',
  'providerTiming',
  'embeddingUsage',
])

/** Visit branded results only; arbitrary business keys with these names are never a removal signal. */
export function checkpointFunctionalOutput<T>(output: T): T {
  const seen = new WeakMap<object, any>()
  const visit = (value: any): any => {
    if (!value || typeof value !== 'object' || value instanceof Date) return value
    if (seen.has(value)) return seen.get(value)
    if (value instanceof Map) {
      const result = new Map()
      seen.set(value, result)
      for (const [key, entry] of value) result.set(visit(key), visit(entry))
      return result
    }
    if (value instanceof Set) {
      const result = new Set()
      seen.set(value, result)
      for (const entry of value) result.add(visit(entry))
      return result
    }
    if (Array.isArray(value)) {
      const result: any[] = []
      seen.set(value, result)
      for (const entry of value) result.push(visit(entry))
      return result
    }
    const facts = getInferenceFacts(value)
    const trustedError = value instanceof Error && facts !== undefined
    if (!trustedError && Object.getPrototypeOf(value) !== Object.prototype) return value
    const omitted = new Set(facts?.generatedFields.filter((key) => NATIVE_REPORT_FIELDS.has(key)))
    const result: Record<string, any> = {}
    seen.set(value, result)
    if (trustedError) {
      result.name = 'Error'
      result.message = safeInferenceError(value)
    }
    for (const [key, entry] of Object.entries(value))
      if (
        !omitted.has(key) &&
        !(trustedError && ['stack', 'cause', 'name', 'message'].includes(key))
      )
        Object.defineProperty(result, key, {
          value: visit(entry),
          enumerable: true,
          writable: true,
          configurable: true,
        })
    return result
  }
  return visit(output)
}

/** Only a private pre-JSON Symbol can create a checkpoint provenance entry. */
function captureMemorySources(value: unknown, workspaceId?: string): CheckpointMemorySources {
  const entries: CheckpointMemorySources['entries'] = []
  const ancestors = new Set<object>()
  const visit = (entry: any, path: Array<string | number>) => {
    if (!entry || typeof entry !== 'object' || entry instanceof Date) return
    if (ancestors.has(entry)) throw new Error('Cyclic checkpoint cannot preserve Memory provenance')
    const source = getWorkflowMessageSource(entry)
    if (source) {
      if (
        !['system', 'user', 'assistant'].includes(entry.role) ||
        typeof entry.content !== 'string'
      )
        throw new Error('Changed trusted Memory message cannot be checkpointed')
      const proof = source.readProof
      if (
        !proof ||
        proof.version !== 1 ||
        typeof proof.workspaceId !== 'string' ||
        !proof.workspaceId ||
        proof.workspaceId !== workspaceId ||
        typeof proof.workflowId !== 'string' ||
        !proof.workflowId ||
        typeof proof.key !== 'string' ||
        !proof.key ||
        typeof proof.digest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(proof.digest) ||
        workflowMessageDigest([entry]) !== proof.digest
      )
        throw new Error(
          'Original complete Memory read proof/body/scope is missing or changed; keep checkpoint pinned'
        )
      const identity = workflowMemoryIdentity(proof.workspaceId, proof.workflowId, proof.key)
      if (identity.threadId !== source.threadId || identity.resourceId !== source.resourceId)
        throw new Error('Original Memory read owner scope differs')
      entries.push({ path, source, digest: proof.digest })
    }
    if (entry instanceof Map || entry instanceof Set) {
      // Executor maps/sets are normalized before capture; arbitrary business maps have no JSON path.
      if (source) throw new Error('Unrepresentable Memory source path')
      return
    }
    ancestors.add(entry)
    if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, [...path, index]))
    else for (const [key, item] of Object.entries(entry)) visit(item, [...path, key])
    ancestors.delete(entry)
  }
  visit(value, [])
  return { version: 2, entries }
}

/** Call before projecting root state/output, so their private provenance survives encrypted JSON. */
export function finalizeExecutorCheckpoint(snapshot: ExecutorCheckpoint): ExecutorCheckpoint {
  assertOccurrenceIds(snapshot.context.blockLogs, 'Malformed checkpoint block occurrence')
  if (
    snapshot.context.workflowMemorySources &&
    snapshot.context.workflowMemorySources.version !== 2
  )
    throw new Error('Original checkpoint Memory read proof is unavailable; keep checkpoint pinned')
  const contextSources = snapshot.context.workflowMemorySources?.entries ?? []
  for (const entry of contextSources) {
    let body: any = snapshot.context
    for (const segment of entry.path) {
      if (!body || typeof body !== 'object' || !Object.hasOwn(body, segment))
        throw new Error('Captured original Memory body path changed')
      body = body[segment]
    }
    const proof = entry.source.readProof
    if (
      !proof ||
      proof.workspaceId !== snapshot.context.workspaceId ||
      entry.digest !== proof.digest ||
      !body ||
      !['system', 'user', 'assistant'].includes(body.role) ||
      typeof body.content !== 'string' ||
      workflowMessageDigest([body]) !== proof.digest
    )
      throw new Error('Captured original Memory read body/scope changed')
  }
  const topSources = captureMemorySources(
    {
      currentBlockStates: snapshot.currentBlockStates,
      finalOutput: snapshot.finalOutput,
    },
    snapshot.context.workspaceId
  )
  const projected = checkpointFunctionalOutput(snapshot)
  projected.context.workflowMemorySources = undefined
  projected.workflowMemorySources = undefined
  const entries = [
    ...topSources.entries,
    ...contextSources.map((entry) => ({ ...entry, path: ['context', ...entry.path] })),
  ]
  if (entries.length) projected.workflowMemorySources = { version: 2, entries }
  return projected
}

export function saveExecutionContext(context: ExecutionContext): SavedContext {
  assertOccurrenceIds(context.blockLogs, 'Malformed checkpoint block occurrence')
  const {
    workflow: _workflow,
    onExecutionEvent: _event,
    pendingExecutionId: _pending,
    shouldCancelExecution: _cancel,
    pausePoints: _pause,
    resumeInputs: _resume,
    ...saved
  } = context
  const { context: _debugContext, ...metadata } = context.metadata
  const normalized: SavedContext = {
    ...saved,
    blockLogs: saved.blockLogs.map((log) => {
      if (!log.inference) return log
      const { nativePayload, model, generatedFields } = log.inference
      const functional = checkpointFunctionalOutput(log.output)
      const output =
        functional && typeof functional === 'object'
          ? Object.fromEntries(
              Object.entries(functional).filter(
                ([key]) => !generatedFields.includes(key) || !NATIVE_REPORT_FIELDS.has(key)
              )
            )
          : functional
      return {
        ...log,
        output,
        inference: { model, generatedFields, ...(nativePayload ? { nativePayload } : {}) },
      }
    }),
    metadata,
    blockStates: [...context.blockStates],
    decisions: {
      router: [...context.decisions.router],
      condition: [...context.decisions.condition],
    },
    loopIterations: [...context.loopIterations],
    loopItems: [...context.loopItems],
    completedLoops: [...context.completedLoops],
    executedBlocks: [...context.executedBlocks],
    activeExecutionPath: [...context.activeExecutionPath],
    loopExecutions:
      context.loopExecutions &&
      [...context.loopExecutions].map(([id, results]) => [id, [...results]]),
    parallelExecutions:
      context.parallelExecutions &&
      [...context.parallelExecutions].map(([id, state]) => [
        id,
        {
          ...state,
          executionResults: [...state.executionResults],
          activeIterations: [...state.activeIterations],
        },
      ]),
    parallelBlockMapping: context.parallelBlockMapping && [...context.parallelBlockMapping],
  }
  const sources = captureMemorySources(normalized, context.workspaceId)
  const projected = checkpointFunctionalOutput(normalized)
  projected.workflowMemorySources = undefined
  if (sources.entries.length) projected.workflowMemorySources = sources
  return projected
}

export function restoreExecutionContext(saved: SavedContext): ExecutionContext {
  assertOccurrenceIds(saved.blockLogs, 'Malformed checkpoint block occurrence')
  const { workflowMemorySources: _sources, ...values } = saved
  return {
    ...values,
    blockStates: new Map(saved.blockStates),
    decisions: {
      router: new Map(saved.decisions.router),
      condition: new Map(saved.decisions.condition),
    },
    loopIterations: new Map(saved.loopIterations),
    loopItems: new Map(saved.loopItems),
    completedLoops: new Set(saved.completedLoops),
    executedBlocks: new Set(saved.executedBlocks),
    activeExecutionPath: new Set(saved.activeExecutionPath),
    loopExecutions:
      saved.loopExecutions &&
      new Map(saved.loopExecutions.map(([id, results]) => [id, new Map(results)])),
    parallelExecutions:
      saved.parallelExecutions &&
      new Map(
        saved.parallelExecutions.map(([id, state]) => [
          id,
          {
            ...state,
            executionResults: new Map(state.executionResults),
            activeIterations: new Set(state.activeIterations),
          },
        ])
      ),
    parallelBlockMapping: saved.parallelBlockMapping && new Map(saved.parallelBlockMapping),
    pausePoints: [],
    resumeInputs: new Map(),
  }
}
