import { Loader2, MinusCircle, TerminalSquare, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { createLogger } from '@/lib/logs/console/logger'

interface GetWorkflowConsoleArgs {
  workflowId: string
  limit?: number
  includeDetails?: boolean
}

export class GetWorkflowConsoleClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_console'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowConsoleClientTool.id, GetWorkflowConsoleClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching workflow console', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching workflow console', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Workflow console fetched', icon: TerminalSquare },
      [ClientToolCallState.error]: { text: 'Failed to read workflow console', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading workflow console',
        icon: MinusCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading workflow console',
        icon: MinusCircle,
      },
      [ClientToolCallState.pending]: { text: 'Fetching workflow console', icon: Loader2 },
    },
  }

  async execute(args?: GetWorkflowConsoleArgs): Promise<void> {
    const logger = createLogger('GetWorkflowConsoleClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const params = (args ?? {}) as Partial<GetWorkflowConsoleArgs>
      const workflowId = params.workflowId?.trim()
      if (!workflowId) {
        logger.error('No target workflow found for console fetch')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'workflowId is required')
        return
      }

      const payload = {
        workflowId,
        limit: params.limit ?? 3,
        includeDetails: params.includeDetails ?? true,
      }

      const result = await executeCopilotServerTool({
        toolName: 'get_workflow_console',
        payload,
      })
      await this.markToolComplete(200, 'Workflow console fetched', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('execute failed', { message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(getCopilotServerToolErrorStatus(e) ?? 500, message)
    }
  }
}
