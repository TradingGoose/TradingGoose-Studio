import { List, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('GetGlobalWorkflowVariablesClientTool')

interface GetGlobalWorkflowVariablesArgs {
  workflowId: string
}

export class GetGlobalWorkflowVariablesClientTool extends BaseClientTool {
  static readonly id = 'get_global_workflow_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      GetGlobalWorkflowVariablesClientTool.id,
      GetGlobalWorkflowVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching workflow variables', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching workflow variables', icon: List },
      [ClientToolCallState.executing]: { text: 'Fetching workflow variables', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted fetching variables', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Workflow variables retrieved', icon: List },
      [ClientToolCallState.error]: { text: 'Failed to fetch variables', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped fetching variables', icon: XCircle },
    },
  }

  async execute(args?: GetGlobalWorkflowVariablesArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const { workflowId, variables: varsRecord } = await getReadableWorkflowState(
        executionContext,
        args?.workflowId
      )
      const variables = Object.values(varsRecord).map((v: any) => ({
        name: String(v?.name || ''),
        value: (v as any)?.value,
      }))

      logger.info('Fetched workflow variables', { workflowId, count: variables.length })
      await this.markToolComplete(200, `Found ${variables.length} variable(s)`, { variables })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to fetch workflow variables')
      this.setState(ClientToolCallState.error)
    }
  }
}
