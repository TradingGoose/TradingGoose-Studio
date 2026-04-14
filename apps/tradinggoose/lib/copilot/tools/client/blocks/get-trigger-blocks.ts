import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import {
  GetTriggerBlocksResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export class GetTriggerBlocksClientTool extends BaseClientTool {
  static readonly id = 'get_trigger_blocks'

  constructor(toolCallId: string) {
    super(toolCallId, GetTriggerBlocksClientTool.id, GetTriggerBlocksClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Found trigger blocks', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to find trigger blocks', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted finding trigger blocks', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped finding trigger blocks', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    const logger = createLogger('GetTriggerBlocksClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const result = GetTriggerBlocksResult.parse(
        await executeCopilotServerTool({
          toolName: 'get_trigger_blocks',
          payload: {},
        })
      )

      await this.markToolComplete(200, 'Successfully retrieved trigger blocks', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
