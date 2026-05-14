import { Loader2, Workflow as WorkflowIcon, X, XCircle } from 'lucide-react'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  buildWorkflowDocumentToolResult,
  buildWorkflowSummary,
  getReadableWorkflowState,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { serializeWorkflowToTgMermaid } from '@/lib/workflows/studio-workflow-mermaid'

interface ReadWorkflowArgs {
  workflowId: string
}

const logger = createLogger('ReadWorkflowClientTool')

export class ReadWorkflowClientTool extends BaseClientTool {
  static readonly id = CopilotTool.read_workflow

  constructor(toolCallId: string) {
    super(toolCallId, ReadWorkflowClientTool.id, ReadWorkflowClientTool.metadata)
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

  async execute(args?: ReadWorkflowArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const requestedWorkflowId = args?.workflowId?.trim()

      if (!requestedWorkflowId) {
        await this.markToolComplete(400, 'workflowId is required')
        this.setState(ClientToolCallState.error)
        return
      }

      logger.info('Reading workflow from readable workflow snapshot', {
        workflowId: requestedWorkflowId,
      })

      const { workflowId, workflowName, workflowState, workspaceId } =
        await getReadableWorkflowState(executionContext, requestedWorkflowId)

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
      await this.markToolComplete(200, 'Workflow analyzed', {
        ...buildWorkflowDocumentToolResult({
          workflowId,
          workflowName,
          workspaceId,
          workflowDocument,
        }),
        workflowSummary: buildWorkflowSummary(workflowState),
      })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', {
        toolCallId: this.toolCallId,
        error,
        message,
      })
      await this.markToolComplete(500, message || 'Failed to read workflow')
      this.setState(ClientToolCallState.error)
    }
  }
}
