import type { BlockOutput } from '@/blocks/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

type MapEntries<T> = T extends Map<infer Key, infer Value> ? [Key, Value][] : never
type LoopState = NonNullable<ExecutionContext['loopExecutions']> extends Map<string, infer State>
  ? State
  : never
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
  loopExecutions?: [
    string,
    Omit<LoopState, 'executionResults'> & { executionResults: [string, unknown][] },
  ][]
  parallelExecutions?: [
    string,
    Omit<ParallelState, 'executionResults' | 'activeIterations'> & {
      executionResults: [string, unknown][]
      activeIterations: number[]
    },
  ][]
  parallelBlockMapping?: MapEntries<NonNullable<ExecutionContext['parallelBlockMapping']>>
}

/** Internal, encrypted at rest. Never include this in public execution results or events. */
export type ExecutorCheckpoint = {
  workflow: SerializedWorkflow
  currentBlockStates: Record<string, BlockOutput>
  context: SavedContext
  iteration: number
  finalOutput: NormalizedBlockOutput
}

export function saveExecutionContext(context: ExecutionContext): SavedContext {
  const {
    workflow: _workflow,
    onExecutionEvent: _onExecutionEvent,
    shouldCancelExecution: _shouldCancelExecution,
    pausePoints: _pausePoints,
    resumeInputs: _resumeInputs,
    ...saved
  } = context
  const { context: _debugContext, ...metadata } = context.metadata
  return {
    ...saved,
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
      [...context.loopExecutions].map(([id, state]) => [
        id,
        { ...state, executionResults: [...state.executionResults] },
      ]),
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
}

export function restoreExecutionContext(saved: SavedContext): ExecutionContext {
  return {
    ...saved,
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
      new Map(
        saved.loopExecutions.map(([id, state]) => [
          id,
          { ...state, executionResults: new Map(state.executionResults) },
        ])
      ),
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
