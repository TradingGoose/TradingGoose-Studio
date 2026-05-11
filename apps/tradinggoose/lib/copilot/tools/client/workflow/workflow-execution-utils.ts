import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { runQueuedWorkflowExecution } from '@/lib/workflows/queued-execution-client'
import { TriggerUtils } from '@/lib/workflows/triggers'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowExecutionUtils')

type WorkflowExecutionOptions = {
  workflowInput?: any
  executionId?: string
  triggerType: 'chat' | 'manual' | 'api'
  workflowId: string
}

function createExecutionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function resolveStartBlockId(
  blocks: Record<string, any>,
  triggerType: WorkflowExecutionOptions['triggerType']
) {
  if (triggerType === 'chat') {
    return TriggerUtils.findStartBlock(blocks, 'chat')?.blockId
  }

  const apiTrigger = TriggerUtils.findStartBlock(blocks, 'api')?.blockId
  if (apiTrigger) return apiTrigger

  return TriggerUtils.findStartBlock(blocks, 'manual')?.blockId
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
      workflowId: options.workflowId,
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
  const startBlockId = resolveStartBlockId(blocks, options.triggerType)
  if (!startBlockId) {
    throw new Error('Workflow requires a chat, API, or manual trigger block to execute')
  }

  logger.info('Executing workflow through server route', {
    workflowId: options.workflowId,
    triggerType: options.triggerType,
    blockCount: Object.keys(blocks).length,
    edgeCount: workflowState.edges.length,
  })

  return runQueuedWorkflowExecution({
    workflowId: options.workflowId,
    executionId: options.executionId ?? createExecutionId(),
    input: options.workflowInput,
    triggerType: options.triggerType,
    executionTarget: 'live',
    workflowData: {
      blocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
    },
    workflowVariables,
    startBlockId,
  })
}
