import { FileText, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { serializeWorkflowToTgMermaid } from '@/lib/workflows/studio-workflow-mermaid'
import {
  buildWorkflowDocumentToolResult,
  getReadableWorkflowState,
  resolveWorkflowTarget,
} from './workflow-review-tool-utils'

const logger = createLogger('GetWorkflowFromNameClientTool')

interface GetWorkflowFromNameArgs {
  workflow_name: string
}

export class GetWorkflowFromNameClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_from_name'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowFromNameClientTool.id, GetWorkflowFromNameClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Retrieving workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Retrieving workflow', icon: FileText },
      [ClientToolCallState.executing]: { text: 'Retrieving workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted retrieving workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved workflow', icon: FileText },
      [ClientToolCallState.error]: { text: 'Failed to retrieve workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped retrieving workflow', icon: XCircle },
    },
  }

  async execute(args?: GetWorkflowFromNameArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const workflowName = args?.workflow_name?.trim()
      if (!workflowName) {
        await this.markToolComplete(400, 'workflow_name is required')
        this.setState(ClientToolCallState.error)
        return
      }

      const executionContext = this.requireExecutionContext()
      const {
        workflowId,
        workflowName: resolvedWorkflowName,
        workspaceId,
      } = await resolveWorkflowTarget(
        executionContext,
        { workflow_name: workflowName }
      )
      const { workflowState } = await getReadableWorkflowState(executionContext, workflowId)
      if (!workflowState?.blocks) {
        await this.markToolComplete(422, 'Workflow state is empty or invalid')
        this.setState(ClientToolCallState.error)
        return
      }

      const workflowDocument = serializeWorkflowToTgMermaid(workflowState)

      await this.markToolComplete(
        200,
        `Retrieved workflow ${resolvedWorkflowName || workflowName}`,
        buildWorkflowDocumentToolResult({
          workflowId,
          workflowName: resolvedWorkflowName || workflowName,
          workspaceId,
          workflowDocument,
        })
      )
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to retrieve workflow by name')
      this.setState(ClientToolCallState.error)
    }
  }
}
