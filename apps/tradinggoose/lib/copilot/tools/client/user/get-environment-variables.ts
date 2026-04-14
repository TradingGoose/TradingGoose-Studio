import { KeyRound, Loader2, MinusCircle, XCircle } from 'lucide-react'
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

interface GetEnvArgs {
  userId?: string
  workflowId?: string
}

export class GetEnvironmentVariablesClientTool extends BaseClientTool {
  static readonly id = 'get_environment_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      GetEnvironmentVariablesClientTool.id,
      GetEnvironmentVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Reading environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read environment variables', icon: KeyRound },
      [ClientToolCallState.error]: { text: 'Failed to read environment variables', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading environment variables',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading environment variables',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetEnvArgs): Promise<void> {
    const logger = createLogger('GetEnvironmentVariablesClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: GetEnvArgs = { ...(args || {}) }
      if (!payload.workflowId) {
        const activeWorkflowId = useWorkflowRegistry.getState().getActiveWorkflowId()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      const result = await executeCopilotServerTool({
        toolName: 'get_environment_variables',
        payload,
      })
      await this.markToolComplete(200, 'Environment variables fetched', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(
        getCopilotServerToolErrorStatus(e) ?? 500,
        e?.message || 'Failed to get environment variables'
      )
    }
  }
}
