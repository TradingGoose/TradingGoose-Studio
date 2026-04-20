import { Globe, Loader2, MinusCircle, XCircle } from 'lucide-react'
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

interface SearchOnlineArgs {
  query: string
  num?: number
  type?: string
  gl?: string
  hl?: string
}

export class SearchOnlineClientTool extends BaseClientTool {
  static readonly id = 'search_online'

  constructor(toolCallId: string) {
    super(toolCallId, SearchOnlineClientTool.id, SearchOnlineClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Online search complete', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to search online', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped online search', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted online search', icon: XCircle },
    },
  }

  async execute(args?: SearchOnlineArgs): Promise<void> {
    const logger = createLogger('SearchOnlineClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const result = await executeCopilotServerTool({
        toolName: 'search_online',
        payload: args || {},
      })
      await this.markToolComplete(200, 'Online search complete', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(
        getCopilotServerToolErrorStatus(e) ?? 500,
        e?.message || 'Search failed'
      )
    }
  }
}
