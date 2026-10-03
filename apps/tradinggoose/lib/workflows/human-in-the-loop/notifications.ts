import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console/logger'
import { workflowPauseLinks } from '@/lib/workflows/human-in-the-loop/links'
import type { WorkflowPausePoint } from '@/lib/workflows/human-in-the-loop/types'
import { type ExecutorCheckpoint, restoreExecutionContext } from '@/executor/checkpoint'
import { LoopManager } from '@/executor/loops/loops'
import { InputResolver } from '@/executor/resolver/resolver'
import { executeTool } from '@/tools'

const logger = createLogger('WorkflowApprovalNotifications')

/** Called only after the checkpoint commits. Notification failures never approve a workflow. */
export async function dispatchWorkflowPauseNotifications(
  checkpoint: ExecutorCheckpoint,
  points: WorkflowPausePoint[]
) {
  const context = restoreExecutionContext(checkpoint.context)
  context.workflow = checkpoint.workflow
  const paths = BlockPathCalculator.calculateAccessibleBlocksForWorkflow(checkpoint.workflow)
  const resolver = new InputResolver(
    checkpoint.workflow,
    context.environmentVariables,
    context.workflowVariables ?? {},
    paths,
    new LoopManager(checkpoint.workflow.loops)
  )
  for (const point of points) {
    const block = checkpoint.workflow.blocks.find((candidate) => candidate.id === point.blockId)
    if (!block || !context.executionId) continue
    context.currentVirtualBlockId = point.id === block.id ? undefined : point.id
    context.blockStates.set(point.id, {
      output: workflowPauseLinks(context.workflowId, context.executionId),
      executed: false,
      executionTime: 0,
    })
    for (const notification of point.notification ?? []) {
      try {
        const params = resolver.resolveInputs(
          {
            ...block,
            config: {
              ...block.config,
              params: notification.params ?? {},
            },
          },
          context
        )
        const result = await executeTool(notification.toolId, params, false, context)
        if (!result.success) throw new Error(result.error ?? 'Notification failed')
      } catch (error) {
        logger.error('Approval notification failed; the workflow remains paused', {
          executionId: context.executionId,
          blockId: point.blockId,
          toolId: notification.toolId,
          error,
        })
      }
    }
  }
}
