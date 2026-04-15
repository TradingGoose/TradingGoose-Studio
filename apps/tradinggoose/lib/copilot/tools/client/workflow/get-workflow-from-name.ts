import { FileText, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import {
  serializeWorkflowToTgMermaid,
  TG_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/studio-workflow-mermaid'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getReadableWorkflowSnapshot } from './workflow-review-tool-utils'

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

      // Try to find by name from registry first to get ID
      const registry = useWorkflowRegistry.getState()
      const match = Object.values((registry as any).workflows || {}).find(
        (w: any) =>
          String(w?.name || '')
            .trim()
            .toLowerCase() === workflowName.toLowerCase()
      ) as any

      if (!match?.id) {
        await this.markToolComplete(404, `Workflow not found: ${workflowName}`)
        this.setState(ClientToolCallState.error)
        return
      }

      const executionContext = this.requireExecutionContext()
      const { workflowState } = await getReadableWorkflowSnapshot(executionContext, match.id)
      if (!workflowState?.blocks) {
        await this.markToolComplete(422, 'Workflow state is empty or invalid')
        this.setState(ClientToolCallState.error)
        return
      }

      const workflowDocument = serializeWorkflowToTgMermaid(workflowState)

      await this.markToolComplete(200, `Retrieved workflow ${workflowName}`, {
        documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
        workflowDocument,
      })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to retrieve workflow by name')
      this.setState(ClientToolCallState.error)
    }
  }
}
