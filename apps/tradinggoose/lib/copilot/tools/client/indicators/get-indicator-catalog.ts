import { BookOpenText, Loader2, MinusCircle, XCircle } from 'lucide-react'
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
  GetIndicatorCatalogInput,
  GetIndicatorCatalogResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface GetIndicatorCatalogArgs {
  sections?: string[]
  query?: string
  includeItems?: boolean
}

export class GetIndicatorCatalogClientTool extends BaseClientTool {
  static readonly id = 'get_indicator_catalog'

  constructor(toolCallId: string) {
    super(toolCallId, GetIndicatorCatalogClientTool.id, GetIndicatorCatalogClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring indicator catalog', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring indicator catalog', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring indicator catalog', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored indicator catalog', icon: BookOpenText },
      [ClientToolCallState.error]: { text: 'Failed to explore indicator catalog', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted exploring indicator catalog',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped exploring indicator catalog',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetIndicatorCatalogArgs): Promise<void> {
    const logger = createLogger('GetIndicatorCatalogClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload = GetIndicatorCatalogInput.parse(args ?? {})
      const result = GetIndicatorCatalogResult.parse(
        await executeCopilotServerTool({
          toolName: 'get_indicator_catalog',
          payload,
        })
      )

      await this.markToolComplete(200, { retrieved: result.count }, result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', { message })
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
