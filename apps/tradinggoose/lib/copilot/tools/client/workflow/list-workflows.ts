import { ListChecks, Loader2, X, XCircle } from 'lucide-react'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { listWorkflowsForExecutionContext } from './workflow-review-tool-utils'

const logger = createLogger('ListWorkflowsClientTool')

export class ListWorkflowsClientTool extends BaseClientTool {
  static readonly id = CopilotTool.list_workflows

  constructor(toolCallId: string) {
    super(toolCallId, ListWorkflowsClientTool.id, ListWorkflowsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing your workflows', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing your workflows', icon: ListChecks },
      [ClientToolCallState.executing]: { text: 'Listing your workflows', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted listing workflows', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Listed your workflows', icon: ListChecks },
      [ClientToolCallState.error]: { text: 'Failed to list workflows', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped listing workflows', icon: XCircle },
    },
  }

  async execute(): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const workflows = await listWorkflowsForExecutionContext(executionContext)
      const entities = workflows.map((workflow) => ({
        entityId: workflow.workflowId,
        ...(workflow.entityName ? { entityName: workflow.entityName } : {}),
        ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
      }))

      logger.info('Found workflows', { count: workflows.length })

      await this.markToolComplete(200, `Found ${workflows.length} workflow(s)`, {
        entityKind: 'workflow',
        entities,
        count: workflows.length,
      })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to list workflows')
      this.setState(ClientToolCallState.error)
    }
  }
}
