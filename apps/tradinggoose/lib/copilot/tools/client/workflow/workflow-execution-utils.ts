/**
 * Standalone workflow execution utilities
 * This allows workflow execution with proper logging from both React hooks and tools
 */

import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedWorkflow } from '@/serializer/types'
import {
  getReadableWorkflowState,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'

const logger = createLogger('WorkflowExecutionUtils')

// Interface for executor options (copied from useWorkflowExecution)
interface ExecutorOptions {
  workflow: SerializedWorkflow
  currentBlockStates?: Record<string, BlockOutput>
  envVarValues?: Record<string, string>
  workflowInput?: any
  workflowVariables?: Record<string, any>
  contextExtensions?: {
    stream?: boolean
    selectedOutputs?: string[]
    edges?: Array<{ source: string; target: string }>
    onStream?: (streamingExecution: StreamingExecution) => Promise<void>
    executionId?: string
  }
}

export interface WorkflowExecutionOptions {
  workflowInput?: any
  executionId?: string
  onStream?: (se: StreamingExecution) => Promise<void>
  channelId?: string
  workflowId?: string
}

export interface WorkflowExecutionContext {
  activeWorkflowId: string
  currentWorkflow: WorkflowSnapshot
  workspaceId: string | null
  workflowVariables: Record<string, any>
  getAllVariables: () => any
  setExecutor: (executor: Executor) => void
}

/**
 * Get the current workflow execution context from stores
 */
export async function getWorkflowExecutionContext(
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  workflowId?: string
): Promise<WorkflowExecutionContext> {
  const activeWorkflowId = workflowId
  if (!activeWorkflowId) {
    throw new Error('Workflow target is required')
  }

  const {
    workflowState: currentWorkflow,
    variables: workflowVariables,
    workspaceId,
  } =
    await getReadableWorkflowState(
      {
        toolCallId: 'workflow-execution-context',
        toolName: 'run_workflow',
        channelId,
        workflowId: activeWorkflowId,
      },
      activeWorkflowId
    )

  const { getAllVariables } = useEnvironmentStore.getState()
  const { setExecutor } = useExecutionStore.getState()

  return {
    activeWorkflowId,
    currentWorkflow,
    workspaceId,
    workflowVariables,
    getAllVariables,
    setExecutor,
  }
}

/**
 * Execute a workflow with proper state management and logging
 * This is the core execution logic extracted from useWorkflowExecution
 */
export async function executeWorkflowWithLogging(
  context: WorkflowExecutionContext,
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const {
    activeWorkflowId,
    currentWorkflow,
    workspaceId,
    workflowVariables,
    getAllVariables,
    setExecutor,
  } = context
  const { workflowInput, onStream, executionId } = options

  const {
    blocks: workflowBlocks,
    edges: workflowEdges,
    loops: workflowLoops,
    parallels: workflowParallels,
  } = currentWorkflow

  // Filter out blocks without type (these are layout-only blocks)
  const validBlocks = Object.entries(workflowBlocks).reduce(
    (acc, [blockId, block]) => {
      if (block && typeof block === 'object' && 'type' in block && block.type) {
        acc[blockId] = block
      }
      return acc
    },
    {} as typeof workflowBlocks
  )

  const isExecutingFromChat =
    workflowInput && typeof workflowInput === 'object' && 'input' in workflowInput

  logger.info('Executing workflow', {
    isExecutingFromChat,
    totalBlocksCount: Object.keys(workflowBlocks).length,
    validBlocksCount: Object.keys(validBlocks).length,
    edgesCount: workflowEdges.length,
  })

  const mergedStates = validBlocks

  const currentBlockStates = Object.entries(mergedStates).reduce(
    (acc, [id, block]) => {
      acc[id] = Object.entries(block.subBlocks).reduce(
        (subAcc, [key, subBlock]) => {
          subAcc[key] = subBlock.value
          return subAcc
        },
        {} as Record<string, any>
      )
      return acc
    },
    {} as Record<string, Record<string, any>>
  )

  // Get environment variables with workspace precedence
  const workspaceEnv = workspaceId
    ? (await useEnvironmentStore.getState().loadWorkspaceEnvironment(workspaceId)).workspace
    : {}
  const envVarValues = Object.entries(getAllVariables()).reduce(
    (acc, [key, variable]: [string, any]) => {
      acc[key] = variable.value
      return acc
    },
    {} as Record<string, string>
  )
  Object.assign(envVarValues, workspaceEnv)

  // Get workflow variables
  // Create serialized workflow with filtered blocks and edges
  const workflow = new Serializer().serializeWorkflow(
    mergedStates,
    workflowEdges,
    workflowLoops,
    workflowParallels
  )

  // If this is a chat execution, get the selected outputs
  let selectedOutputs: string[] | undefined
  if (isExecutingFromChat) {
    // Get selected outputs from chat store
    const chatStore = await import('@/stores/chat/store').then((mod) => mod.useChatStore)
    selectedOutputs = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
  }

  // Create executor options
  const executorOptions: ExecutorOptions = {
    workflow,
    currentBlockStates,
    envVarValues,
    workflowInput,
    workflowVariables,
    contextExtensions: {
      stream: isExecutingFromChat,
      selectedOutputs,
      edges: workflow.connections.map((conn) => ({
        source: conn.source,
        target: conn.target,
      })),
      onStream,
      executionId,
    },
  }

  // Create executor and store in global state
  const newExecutor = new Executor(executorOptions)
  setExecutor(newExecutor)

  // Execute workflow
  return newExecutor.execute(activeWorkflowId)
}

/**
 * Persist execution logs to the backend
 */
export async function persistExecutionLogs(
  activeWorkflowId: string,
  executionId: string,
  result: ExecutionResult,
  streamContent?: string
): Promise<string> {
  try {
    // Build trace spans from execution logs
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Add trace spans to the execution result
    const enrichedResult = {
      ...result,
      traceSpans,
      totalDuration,
    }

    // If this was a streaming response and we have the final content, update it
    if (streamContent && result.output && typeof streamContent === 'string') {
      // Update the content with the final streaming content
      enrichedResult.output.content = streamContent

      // Also update any block logs to include the content where appropriate
      if (enrichedResult.logs) {
        // Get the streaming block ID from metadata if available
        const streamingBlockId = (result.metadata as any)?.streamingBlockId || null

        for (const log of enrichedResult.logs) {
          // Only update the specific LLM block (agent/router) that was streamed
          const isStreamingBlock = streamingBlockId && log.blockId === streamingBlockId
          if (
            isStreamingBlock &&
            (log.blockType === 'agent' || log.blockType === 'router') &&
            log.output
          ) {
            log.output.content = streamContent
          }
        }
      }
    }

    const response = await fetch(`/api/workflows/${activeWorkflowId}/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        executionId,
        result: enrichedResult,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to persist logs')
    }

    return executionId
  } catch (error) {
    logger.error('Error persisting logs:', error)
    return executionId
  }
}

/**
 * Execute workflow with full logging support
 * This combines execution + log persistence in a single function
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const context = await getWorkflowExecutionContext(options.channelId, options.workflowId)
  const executionId = options.executionId || uuidv4()

  try {
    const result = await executeWorkflowWithLogging(context, {
      ...options,
      executionId,
    })

    // For ExecutionResult (not streaming), persist logs
    if (result && 'success' in result) {
      // Don't await log persistence to avoid blocking the UI
      persistExecutionLogs(context.activeWorkflowId, executionId, result as ExecutionResult).catch(
        (err) => {
          logger.error('Error persisting logs:', { error: err })
        }
      )
    }

    return result
  } catch (error: any) {
    // Create error result and persist it
    const errorResult: ExecutionResult = {
      success: false,
      output: { error: error?.message || 'Unknown error' },
      logs: [],
      metadata: { duration: 0, startTime: new Date().toISOString() },
    }

    persistExecutionLogs(context.activeWorkflowId, executionId, errorResult).catch((err) => {
      logger.error('Error persisting logs:', { error: err })
    })

    throw error
  }
}
