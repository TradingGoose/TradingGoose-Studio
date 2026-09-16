import { normalizeWorkflowPauseInputFormat } from '@/lib/workflows/human-in-the-loop/form'
import { workflowPauseLinks } from '@/lib/workflows/human-in-the-loop/links'
import type { WorkflowPauseNotification } from '@/lib/workflows/human-in-the-loop/types'
import { BlockType } from '@/executor/consts'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  PausedBlockExecution,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

export class HumanInTheLoopBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput | PausedBlockExecution> {
    if (!context.executionId || !context.userId) {
      throw new Error('Human in the Loop requires an authenticated server workflow execution')
    }
    const id = context.currentVirtualBlockId ?? block.id
    const links = workflowPauseLinks(context.workflowId, context.executionId)
    if (context.resumeInputs?.has(id)) {
      const input = context.resumeInputs.get(id)!
      context.resumeInputs.delete(id)
      return { ...input, ...links }
    }

    const inputFormat = normalizeWorkflowPauseInputFormat(inputs.inputFormat)
    const display = await new ResponseBlockHandler().execute(block, {
      dataMode: 'structured',
      builderData: inputs.builderData,
    })
    const response = display.response as { status: number; data: Record<string, unknown> }
    if (response.status !== 200) {
      throw new Error('Human in the Loop display data is invalid')
    }
    const notification = inputs.notification ?? []
    if (
      !Array.isArray(notification) ||
      notification.some(
        (entry) =>
          !entry ||
          typeof entry !== 'object' ||
          typeof entry.toolId !== 'string' ||
          !entry.toolId.trim()
      )
    ) {
      throw new Error('Human in the Loop notifications must select executable tools')
    }
    return {
      kind: 'paused',
      pausePoint: {
        id,
        blockId: block.id,
        blockName: block.metadata?.name ?? 'Human in the Loop',
        kind: 'human',
        displayData: response.data,
        inputFormat,
        notification: notification as WorkflowPauseNotification[],
      },
    }
  }
}
