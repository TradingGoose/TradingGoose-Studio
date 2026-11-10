import type { WorkflowExecutionEventInput } from '@/lib/workflows/execution-events'
import type { WorkflowPausePoint } from '@/lib/workflows/human-in-the-loop/types'
import type { BlockOutput } from '@/blocks/types'
import type { ExecutorCheckpoint } from '@/executor/checkpoint'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { TriggerType } from '@/services/queue'

export type ExecutionSubmissionSource = 'manual' | 'copilot' | 'workflow'

/**
 * User-facing file object with simplified interface
 */
export interface UserFile {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
  uploadedAt: string
  expiresAt: string
  context?: string
}

/** Business schema roots are unrestricted; trusted outcome and inference facts live separately. */
export type NormalizedBlockOutput = Record<string, any>

/**
 * Execution log entry for a single block.
 */
export interface BlockLog {
  id: string // Saved server-owned identity for this actual block occurrence
  inference?: import('@/lib/mastra/result').InferenceFacts
  blockId: string // Unique identifier of the executed block
  blockName?: string // Display name of the block
  blockType?: string // Type of the block (agent, router, etc.)
  startedAt: string // ISO timestamp when execution started
  endedAt: string // ISO timestamp when execution completed
  durationMs: number // Duration of execution in milliseconds
  success: boolean // Whether execution completed successfully
  output?: any // Output data from successful execution
  input?: any // Input data for the block execution
  error?: string // Error message if execution failed
}

/** Refuse unproved occurrence identity; never allocate or normalize during preservation. */
export function assertOccurrenceIds(values: unknown, message: string): void {
  if (!Array.isArray(values)) throw new Error(message)
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
    const prototype = Object.getPrototypeOf(value)
    if ((prototype !== Object.prototype && prototype !== null) || !Object.hasOwn(value, 'id'))
      throw new Error(message)
    const descriptor = Object.getOwnPropertyDescriptor(value, 'id')
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error(message)
    const toJSON = Object.getOwnPropertyDescriptor(value, 'toJSON')
    if (toJSON && (!('value' in toJSON) || typeof toJSON.value === 'function'))
      throw new Error(message)
    const id = descriptor.value
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) throw new Error(message)
    seen.add(id)
  }
}

/**
 * Timing metadata for workflow execution.
 */
export interface ExecutionMetadata {
  startTime?: string // ISO timestamp when workflow execution started
  endTime?: string // ISO timestamp when workflow execution completed
  duration: number // Duration of workflow execution in milliseconds
  pendingBlocks?: string[] // List of block IDs that are pending execution
  isDebugSession?: boolean // Whether the workflow is running in debug mode
  hasResponseBlock?: boolean // Whether a response block produced the final HTTP response
  context?: ExecutionContext // Runtime context for the workflow
  workflowConnections?: Array<{ source: string; target: string }> // Connections between workflow blocks
}

/**
 * Current state of a block during workflow execution.
 */
export interface BlockState {
  success?: boolean
  output: NormalizedBlockOutput // Current output data from the block
  executed: boolean // Whether the block has been executed
  executionTime: number // Time taken to execute in milliseconds
}

/**
 * Runtime context for workflow execution.
 */
export interface ExecutionContext {
  workflowId: string // Unique identifier for this workflow execution
  workspaceId: string // Workspace ID for file storage scoping
  userId?: string // Authenticated acting user for internal server-to-server calls
  executionId?: string // Unique execution ID for file storage scoping
  pendingExecutionId?: string // Active queue attempt that owns execution capacity
  workflowLogId?: string
  submissionSource?: ExecutionSubmissionSource
  triggerType?: TriggerType
  triggerBlockId?: string
  workflowDepth?: number
  // Whether this execution is running against deployed state (API/webhook/schedule/chat)
  // Manual executions in the builder should leave this undefined/false
  isDeployedContext?: boolean
  blockStates: Map<string, BlockState>
  blockLogs: BlockLog[] // Chronological log of block executions
  metadata: ExecutionMetadata // Timing metadata for the execution
  environmentVariables: Record<string, string> // Environment variables available during execution
  workflowVariables?: Record<string, any> // Workflow variables available during execution

  // Routing decisions for path determination
  decisions: {
    router: Map<string, string> // Router block ID -> Target block ID
    condition: Map<string, string> // Condition block ID -> Selected condition ID
  }

  loopIterations: Map<string, number> // Tracks current iteration count for each loop
  loopItems: Map<string, any> // Tracks current item for forEach loops and parallel distribution
  completedLoops: Set<string> // Tracks which loops have completed all iterations

  // Parallel execution tracking
  parallelExecutions?: Map<
    string,
    {
      parallelCount: number
      distributionItems: any[] | Record<string, any> | null
      completedExecutions: number
      executionResults: Map<string, any>
      activeIterations: Set<number>
      currentIteration: number
      parallelType?: 'count' | 'collection'
    }
  >

  // Loop execution tracking
  loopExecutions?: Map<string, Map<string, any>> // loopId -> iteration key -> outputs

  // Mapping for virtual parallel block IDs to their original blocks
  parallelBlockMapping?: Map<
    string,
    {
      originalBlockId: string
      parallelId: string
      iterationIndex: number
    }
  >

  // Current virtual block being executed (for parallel iterations)
  currentVirtualBlockId?: string

  // Execution tracking
  executedBlocks: Set<string> // Set of block IDs that have been executed
  activeExecutionPath: Set<string> // Set of block IDs in the current execution path

  workflow?: SerializedWorkflow // Reference to the workflow being executed

  // Streaming support and output selection
  stream?: boolean // Whether to use streaming responses when available
  selectedOutputs?: string[] // IDs of blocks selected for streaming output
  edges?: Array<{ source: string; target: string }> // Workflow edge connections

  onExecutionEvent?: (event: WorkflowExecutionEventInput) => Promise<void>
  shouldCancelExecution?: () => Promise<boolean>
  pausePoints?: WorkflowPausePoint[]
  resumeInputs?: Map<string, Record<string, unknown>>
}

/**
 * Optional context values that are threaded into executor-created requests.
 */
export interface ExecutionContextExtensions {
  stream?: boolean // Whether to use streaming responses when available
  selectedOutputs?: string[] // IDs of blocks selected for streaming output
  edges?: Array<{ source: string; target: string }> // Workflow edge connections
  onExecutionEvent?: (event: WorkflowExecutionEventInput) => Promise<void>
  shouldCancelExecution?: () => Promise<boolean>
  executionId?: string
  pendingExecutionId?: string // Active queue attempt that owns execution capacity
  workspaceId: string
  userId?: string
  workflowLogId?: string
  submissionSource?: ExecutionSubmissionSource
  triggerType?: TriggerType
  workflowDepth?: number
  isChildExecution?: boolean
  // Marks executions that must use deployed constraints (API/webhook/schedule/chat)
  isDeployedContext?: boolean
}

/**
 * Complete result from executing a workflow.
 */
export interface ExecutionResult {
  success: boolean // Whether the workflow executed successfully
  status?: 'paused'
  pausePoints?: WorkflowPausePoint[]
  /** Internal executor state. Strip before emitting events or returning to clients. */
  checkpoint?: ExecutorCheckpoint
  output: NormalizedBlockOutput // Final output data from the workflow
  error?: string // Error message if execution failed
  logs?: BlockLog[] // Execution logs for all blocks
  metadata?: ExecutionMetadata
}

/**
 * Streaming execution result combining a readable stream with execution metadata.
 * This allows us to stream content to the UI while still capturing all execution logs.
 */
export interface StreamingExecution {
  stream: ReadableStream // The streaming response for the UI to consume
  execution: ExecutionResult & { isStreaming?: boolean } // The complete execution data for logging purposes
}

export interface DeferredBlockExecution {
  kind: 'deferred'
  wait: () => Promise<BlockOutput | PausedBlockExecution>
}

/** Internal control result, never inferred from workflow data. */
export class PausedBlockExecution {
  constructor(readonly pausePoint: WorkflowPausePoint) {}
}

/**
 * Interface for block handlers that execute specific block types.
 * Each handler is responsible for executing a particular type of block.
 */
export interface BlockHandler {
  /**
   * Determines if this handler can process the given block.
   *
   * @param block - Block to check
   * @returns True if this handler can process the block
   */
  canHandle(block: SerializedBlock): boolean

  /**
   * Executes the block with the given inputs and context.
   *
   * @param block - Block to execute
   * @param inputs - Resolved input parameters
   * @param context - Current execution context
   * @returns Block execution output or StreamingExecution for streaming
   */
  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution | DeferredBlockExecution | PausedBlockExecution>
}
