import { Blocks, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { GetBlocksAndToolsResult } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export class GetBlocksAndToolsClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_and_tools'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksAndToolsClientTool.id, GetBlocksAndToolsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring workflow blocks', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring workflow blocks', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring workflow blocks', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored workflow blocks', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to explore workflow blocks', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted exploring workflow blocks', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped exploring workflow blocks', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    const logger = createLogger('GetBlocksAndToolsClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const result = GetBlocksAndToolsResult.parse(
        await executeCopilotServerTool({
          toolName: 'get_blocks_and_tools',
          payload: {},
        })
      )

      await this.markToolComplete(200, 'Successfully retrieved blocks and tools', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
