/**
 * Standalone workflow execution utilities
 * This allows workflow execution with proper logging from both React hooks and tools
 */

import { v4 as uuidv4 } from 'uuid'
import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import {
  completeWorkflowExecutionLog,
  startWorkflowExecutionLog,
  type WorkflowLogTriggerType,
} from '@/lib/workflows/execution-log-client'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { Executor, type ExecutorOptions } from '@/executor'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import { useExecutionStore } from '@/stores/execution/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

const logger = createLogger('WorkflowExecutionUtils')

type WorkflowExecutionOptions = {
  workflowInput?: any
  executionId?: string
  triggerType: WorkflowLogTriggerType
  onStream?: (se: StreamingExecution) => Promise<void>
  workflowId: string
}

type WorkflowExecutionContext = {
  activeWorkflowId: string
  currentWorkflow: WorkflowSnapshot
  workspaceId: string
  workflowVariables: Record<string, any>
  getAllVariables: () => any
  setExecutor: (executor: Executor) => void
}

type WorkflowExecutionRunOptions = WorkflowExecutionOptions & {
  executionId: string
  workflowLogId: string
}

async function getWorkflowExecutionContext(workflowId: string): Promise<WorkflowExecutionContext> {
  const activeWorkflowId = workflowId
  if (!activeWorkflowId) {
    throw new Error('Workflow target is required')
  }

  const {
    workflowState: currentWorkflow,
    variables: workflowVariables,
    workspaceId,
  } = await getReadableWorkflowState(
    {
      toolCallId: 'workflow-execution-context',
      toolName: 'run_workflow',
      workflowId: activeWorkflowId,
    },
    activeWorkflowId
  )

  const { getAllVariables } = useEnvironmentStore.getState()
  const { setExecutor } = useExecutionStore.getState()

  if (!workspaceId) {
    throw new Error('Workflow execution context requires workspaceId')
  }

  return {
    activeWorkflowId,
    currentWorkflow,
    workspaceId,
    workflowVariables,
    getAllVariables,
    setExecutor,
  }
}

async function executeWorkflowWithLogging(
  context: WorkflowExecutionContext,
  options: WorkflowExecutionRunOptions
): Promise<ExecutionResult | StreamingExecution> {
  const {
    activeWorkflowId,
    currentWorkflow,
    workspaceId,
    workflowVariables,
    getAllVariables,
    setExecutor,
  } = context
  const { workflowInput, onStream, executionId, workflowLogId, triggerType } = options

  const {
    blocks: workflowBlocks,
    edges: workflowEdges,
    loops: workflowLoops,
    parallels: workflowParallels,
  } = currentWorkflow

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

  const workspaceEnv = (await useEnvironmentStore.getState().loadWorkspaceEnvironment(workspaceId))
    .workspace
  const envVarValues = Object.entries(getAllVariables()).reduce(
    (acc, [key, variable]: [string, any]) => {
      acc[key] = variable.value
      return acc
    },
    {} as Record<string, string>
  )
  Object.assign(envVarValues, workspaceEnv)

  const workflow = new Serializer().serializeWorkflow(
    mergedStates,
    workflowEdges,
    workflowLoops,
    workflowParallels
  )

  let selectedOutputs: string[] | undefined
  if (isExecutingFromChat) {
    const chatStore = await import('@/stores/chat/store').then((mod) => mod.useChatStore)
    selectedOutputs = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
  }

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
      workspaceId,
      workflowLogId,
      triggerType,
      submissionSource: 'workflow',
    },
  }

  const newExecutor = new Executor(executorOptions)
  setExecutor(newExecutor)

  return newExecutor.execute(activeWorkflowId)
}

export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions
): Promise<ExecutionResult | StreamingExecution> {
  const context = await getWorkflowExecutionContext(options.workflowId)
  const executionId = options.executionId || uuidv4()
  const triggerType = options.triggerType
  const workflowLogId = await startWorkflowExecutionLog(
    context.activeWorkflowId,
    executionId,
    triggerType
  )
  const completeLog = (result: ExecutionResult) =>
    completeWorkflowExecutionLog({
      executionId,
      result,
      triggerType,
      workflowId: context.activeWorkflowId,
      workflowLogId,
    }).catch((err) => {
      logger.error('Error persisting logs:', { error: err })
    })

  try {
    const result = await executeWorkflowWithLogging(context, {
      ...options,
      executionId,
      triggerType,
      workflowLogId,
    })

    const executionResult = 'success' in result ? result : result.execution
    completeLog(executionResult)

    return result
  } catch (error: any) {
    // Create error result and persist it
    const errorResult: ExecutionResult = {
      success: false,
      output: { error: error?.message || 'Unknown error' },
      logs: [],
      metadata: { duration: 0, startTime: new Date().toISOString() },
    }
    completeLog(errorResult)

    throw error
  }
}
