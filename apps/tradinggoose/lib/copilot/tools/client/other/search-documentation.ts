import { BookOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
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

interface SearchDocumentationArgs {
  query: string
  topK?: number
  threshold?: number
}

export class SearchDocumentationClientTool extends BaseClientTool {
  static readonly id = 'search_documentation'

  constructor(toolCallId: string) {
    super(toolCallId, SearchDocumentationClientTool.id, SearchDocumentationClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Documentation search complete', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
    },
  }

  async execute(args?: SearchDocumentationArgs): Promise<void> {
    const logger = createLogger('SearchDocumentationClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const result = await executeCopilotServerTool({
        toolName: 'search_documentation',
        payload: args || {},
      })
      await this.markToolComplete(200, 'Documentation search complete', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(
        getCopilotServerToolErrorStatus(e) ?? 500,
        e?.message || 'Documentation search failed'
      )
    }
  }
}
