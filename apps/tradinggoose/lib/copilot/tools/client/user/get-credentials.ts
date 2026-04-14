import { createLogger } from '@/lib/logs/console/logger'
import { Key, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface GetCredentialsArgs {
  userId?: string
  workflowId?: string
}

export class GetCredentialsClientTool extends BaseClientTool {
  static readonly id = 'get_credentials'

  constructor(toolCallId: string) {
    super(toolCallId, GetCredentialsClientTool.id, GetCredentialsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching connected integrations', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching connected integrations', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching connected integrations', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Fetched connected integrations', icon: Key },
      [ClientToolCallState.error]: {
        text: 'Failed to fetch connected integrations',
        icon: XCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted fetching connected integrations',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped fetching connected integrations',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetCredentialsArgs): Promise<void> {
    const logger = createLogger('GetCredentialsClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: GetCredentialsArgs = { ...(args || {}) }
      if (!payload.workflowId && !payload.userId) {
        const activeWorkflowId = useWorkflowRegistry.getState().getActiveWorkflowId()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      const result = await executeCopilotServerTool({
        toolName: 'get_credentials',
        payload,
      })
      await this.markToolComplete(200, 'Connected integrations fetched', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(
        getCopilotServerToolErrorStatus(e) ?? 500,
        e?.message || 'Failed to fetch connected integrations'
      )
    }
  }
}
