import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import type { BaseClientToolMetadata } from '@/lib/copilot/tools/client/base-tool'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'

export class EditWorkflowBlockClientTool extends EditWorkflowClientTool {
  static readonly id: string = 'edit_workflow_block'

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing your workflow block', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Editing your workflow block', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited your workflow block', icon: Grid2x2Check },
      [ClientToolCallState.error]: { text: 'Failed to edit your workflow block', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow block changes', icon: Grid2x2 },
      [ClientToolCallState.rejected]: { text: 'Rejected workflow block changes', icon: Grid2x2X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted editing your workflow block',
        icon: MinusCircle,
      },
      [ClientToolCallState.pending]: { text: 'Editing your workflow block', icon: Loader2 },
    },
    interrupt: {
      accept: { text: 'Accept changes', icon: Grid2x2Check },
      reject: { text: 'Reject changes', icon: Grid2x2X },
    },
  }

  constructor(
    toolCallId: string,
    toolName = EditWorkflowBlockClientTool.id,
    metadata: BaseClientToolMetadata = EditWorkflowBlockClientTool.metadata
  ) {
    super(toolCallId, toolName, metadata)
  }

  protected getServerToolName(): string {
    return EditWorkflowBlockClientTool.id
  }

  protected buildServerPayload(
    workflowId: string,
    args: Record<string, any> | undefined,
    currentWorkflowState: string | undefined
  ): Record<string, any> {
    const blockId = args?.blockId?.trim()
    if (!blockId) {
      throw new Error(`blockId is required for ${this.getServerToolName()}`)
    }

    return {
      workflowId,
      blockId,
      ...(args?.blockType?.trim() ? { blockType: args.blockType.trim() } : {}),
      ...(args?.name?.trim() ? { name: args.name.trim() } : {}),
      ...(typeof args?.enabled === 'boolean' ? { enabled: args.enabled } : {}),
      ...(args?.subBlocks ? { subBlocks: args.subBlocks } : {}),
      ...(currentWorkflowState ? { currentWorkflowState } : {}),
    }
  }
}
