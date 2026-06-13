import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { runQueuedWorkflowExecution } from '@/lib/workflows/queued-execution-client'
import { resolveEditorTestTrigger } from '@/lib/workflows/triggers'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowExecutionUtils')

type WorkflowExecutionOptions = {
  workflowInput?: any
  executionId?: string
  workflowId: string
}

function createExecutionId() {
  return globalThis.crypto.randomUUID()
}

export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions
): Promise<ExecutionResult> {
  const {
    workflowState,
    variables: workflowVariables,
    workspaceId,
  } = await getReadableWorkflowState(
    {
      toolCallId: 'workflow-execution-context',
      toolName: 'run_workflow',
    },
    options.workflowId
  )

  if (!workspaceId) {
    throw new Error('Workflow execution context requires workspaceId')
  }

  const blocks = Object.entries(workflowState.blocks).reduce(
    (acc, [blockId, block]) => {
      if (block?.type && block.enabled !== false) {
        acc[blockId] = block
      }
      return acc
    },
    {} as typeof workflowState.blocks
  )
  const start = resolveEditorTestTrigger(blocks, workflowState.edges, options.workflowInput)

  logger.info('Executing workflow through server route', {
    workflowId: options.workflowId,
    triggerType: 'manual',
    startBlockId: start.blockId,
    blockCount: Object.keys(blocks).length,
    edgeCount: workflowState.edges.length,
  })

  return runQueuedWorkflowExecution({
    workflowId: options.workflowId,
    executionId: options.executionId ?? createExecutionId(),
    input: start.input,
    triggerType: 'manual',
    executionTarget: 'live',
    workflowData: {
      blocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
    },
    workflowVariables,
    startBlockId: start.blockId,
  })
}
