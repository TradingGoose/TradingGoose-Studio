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
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface GetBlocksMetadataArgs {
  blockIds: string[]
}

export class GetBlocksMetadataClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_metadata'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksMetadataClientTool.id, GetBlocksMetadataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Inspecting block shapes', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Inspecting block shapes', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Inspecting block shapes', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Inspected block shapes', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to inspect block shapes', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted inspecting block shapes', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped inspecting block shapes',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetBlocksMetadataArgs): Promise<void> {
    const logger = createLogger('GetBlocksMetadataClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const { blockIds } = GetBlocksMetadataInput.parse(args || {})

      const result = GetBlocksMetadataResult.parse(
        await executeCopilotServerTool({
          toolName: 'get_blocks_metadata',
          payload: { blockIds },
        })
      )

      await this.markToolComplete(200, { retrieved: Object.keys(result.metadata).length }, result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', { message })
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
