import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { runQueuedWorkflowExecution } from '@/lib/workflows/queued-execution-client'
import { resolveWorkflowRunTrigger } from '@/lib/workflows/triggers'
import type { ExecutionResult } from '@/executor/types'
import { buildExecutableWorkflowData } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowExecutionUtils')

type WorkflowExecutionOptions = {
  workflowInput?: any
  executionId?: string
  workflowId: string
  triggerBlockId: string
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

  const workflowData = buildExecutableWorkflowData(workflowState.blocks, workflowState.edges)
  const start = resolveWorkflowRunTrigger(workflowData.blocks, workflowData.edges, {
    surface: 'copilot',
    workflowInput: options.workflowInput,
    triggerBlockId: options.triggerBlockId,
  })

  logger.info('Executing workflow through server route', {
    workflowId: options.workflowId,
    triggerType: start.triggerType,
    triggerBlockId: start.blockId,
    blockCount: Object.keys(workflowData.blocks).length,
    edgeCount: workflowData.edges.length,
  })

  return runQueuedWorkflowExecution({
    workflowId: options.workflowId,
    executionId: options.executionId ?? createExecutionId(),
    input: start.input,
    triggerType: start.triggerType,
    executionTarget: 'live',
    workflowData,
    workflowVariables,
    triggerBlockId: start.blockId,
  })
}
