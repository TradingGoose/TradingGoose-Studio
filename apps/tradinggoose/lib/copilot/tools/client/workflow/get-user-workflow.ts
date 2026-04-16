import { Loader2, Workflow as WorkflowIcon, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  buildWorkflowDocumentToolResult,
  getReadableWorkflowState,
  resolveWorkflowTarget,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { serializeWorkflowToTgMermaid } from '@/lib/workflows/studio-workflow-mermaid'

interface GetUserWorkflowArgs {
  workflowId: string
  includeMetadata?: boolean
}

const logger = createLogger('GetUserWorkflowClientTool')

export class GetUserWorkflowClientTool extends BaseClientTool {
  static readonly id = 'get_user_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, GetUserWorkflowClientTool.id, GetUserWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Analyzing your workflow', icon: WorkflowIcon },
      [ClientToolCallState.executing]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted analyzing your workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Analyzed your workflow', icon: WorkflowIcon },
      [ClientToolCallState.error]: { text: 'Failed to analyze your workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped analyzing your workflow', icon: XCircle },
    },
  }

  async execute(args?: GetUserWorkflowArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()

      const { workflowId, workflowName, workspaceId } = await resolveWorkflowTarget(
        executionContext,
        {
          workflowId: args?.workflowId,
        }
      )

      logger.info('Fetching user workflow from readable workflow snapshot', {
        workflowId,
        workflowName,
        includeMetadata: args?.includeMetadata,
      })

      const { workflowState, source } = await getReadableWorkflowState(
        executionContext,
        workflowId
      )

      logger.info('Validating workflow state', {
        workflowId,
        source,
        hasWorkflowState: !!workflowState,
        hasBlocks: !!workflowState?.blocks,
        workflowStateType: typeof workflowState,
      })

      if (!workflowState || !workflowState.blocks) {
        await this.markToolComplete(422, 'Workflow state is empty or invalid')
        this.setState(ClientToolCallState.error)
        return
      }

      let workflowDocument = ''
      try {
        workflowDocument = serializeWorkflowToTgMermaid(workflowState)
        logger.info('Successfully serialized workflow document', {
          workflowId,
          documentLength: workflowDocument.length,
        })
      } catch (stringifyError) {
        await this.markToolComplete(
          500,
          `Failed to convert workflow to Mermaid: ${
            stringifyError instanceof Error ? stringifyError.message : 'Unknown error'
          }`
        )
        this.setState(ClientToolCallState.error)
        return
      }

      // Mark complete with data; keep state success for store render
      await this.markToolComplete(
        200,
        'Workflow analyzed',
        buildWorkflowDocumentToolResult({
          workflowId,
          workflowName,
          workspaceId,
          workflowDocument,
        })
      )
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', {
        toolCallId: this.toolCallId,
        error,
        message,
      })
      await this.markToolComplete(500, message || 'Failed to fetch workflow')
      this.setState(ClientToolCallState.error)
    }
  }
}
