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
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface GetOAuthCredentialsArgs {
  userId?: string
  workflowId?: string
}

export class GetOAuthCredentialsClientTool extends BaseClientTool {
  static readonly id = 'get_oauth_credentials'

  constructor(toolCallId: string) {
    super(toolCallId, GetOAuthCredentialsClientTool.id, GetOAuthCredentialsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching OAuth credentials', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching OAuth credentials', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Retrieving login IDs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved login IDs', icon: Key },
      [ClientToolCallState.error]: { text: 'Failed to retrieve login IDs', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted fetching OAuth credentials',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped fetching OAuth credentials',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetOAuthCredentialsArgs): Promise<void> {
    const logger = createLogger('GetOAuthCredentialsClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: GetOAuthCredentialsArgs = { ...(args || {}) }
      if (!payload.workflowId && !payload.userId) {
        const activeWorkflowId = useWorkflowRegistry.getState().getActiveWorkflowId()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      const result = await executeCopilotServerTool({
        toolName: 'get_oauth_credentials',
        payload,
      })
      await this.markToolComplete(200, 'Retrieved login IDs', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(
        getCopilotServerToolErrorStatus(e) ?? 500,
        e?.message || 'Failed to retrieve login IDs'
      )
    }
  }
}
