import { FileSearch, Loader2, MinusCircle, XCircle } from 'lucide-react'
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
  GetIndicatorMetadataInput,
  GetIndicatorMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface GetIndicatorMetadataArgs {
  targetIds: string[]
}

export class GetIndicatorMetadataClientTool extends BaseClientTool {
  static readonly id = 'get_indicator_metadata'

  constructor(toolCallId: string) {
    super(toolCallId, GetIndicatorMetadataClientTool.id, GetIndicatorMetadataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Inspecting indicator metadata', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Inspecting indicator metadata', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Inspecting indicator metadata', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Inspected indicator metadata', icon: FileSearch },
      [ClientToolCallState.error]: { text: 'Failed to inspect indicator metadata', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted inspecting indicator metadata',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped inspecting indicator metadata',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetIndicatorMetadataArgs): Promise<void> {
    const logger = createLogger('GetIndicatorMetadataClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload = GetIndicatorMetadataInput.parse(args ?? {})
      const result = GetIndicatorMetadataResult.parse(
        await executeCopilotServerTool({
          toolName: 'get_indicator_metadata',
          payload,
        })
      )

      await this.markToolComplete(200, { retrieved: result.items.length }, result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', { message })
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
