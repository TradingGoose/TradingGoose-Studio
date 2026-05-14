import { List, Loader2, X, XCircle } from 'lucide-react'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ReadWorkflowVariablesClientTool')

interface ReadWorkflowVariablesArgs {
  workflowId: string
}

export class ReadWorkflowVariablesClientTool extends BaseClientTool {
  static readonly id = CopilotTool.read_workflow_variables

  constructor(toolCallId: string) {
    super(toolCallId, ReadWorkflowVariablesClientTool.id, ReadWorkflowVariablesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading workflow variables', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading workflow variables', icon: List },
      [ClientToolCallState.executing]: { text: 'Reading workflow variables', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted reading variables', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Read workflow variables', icon: List },
      [ClientToolCallState.error]: { text: 'Failed to read variables', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped reading variables', icon: XCircle },
    },
  }

  async execute(args?: ReadWorkflowVariablesArgs): Promise<void> {
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

      logger.info('Read workflow variables', { workflowId, count: variables.length })
      await this.markToolComplete(200, `Found ${variables.length} variable(s)`, { variables })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to read workflow variables')
      this.setState(ClientToolCallState.error)
    }
  }
}
