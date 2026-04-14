import { FileText, Loader2, MinusCircle, XCircle } from 'lucide-react'
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

interface ReadGDriveFileArgs {
  userId: string
  fileId: string
  type: 'doc' | 'sheet'
  range?: string
}

export class ReadGDriveFileClientTool extends BaseClientTool {
  static readonly id = 'read_gdrive_file'

  constructor(toolCallId: string) {
    super(toolCallId, ReadGDriveFileClientTool.id, ReadGDriveFileClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading Google Drive file', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading Google Drive file', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading Google Drive file', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read Google Drive file', icon: FileText },
      [ClientToolCallState.error]: { text: 'Failed to read Google Drive file', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted reading Google Drive file', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading Google Drive file',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: ReadGDriveFileArgs): Promise<void> {
    const logger = createLogger('ReadGDriveFileClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const result = await executeCopilotServerTool({
        toolName: 'read_gdrive_file',
        payload: args || {},
      })
      await this.markToolComplete(200, 'Read Google Drive file', result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(
        getCopilotServerToolErrorStatus(e) ?? 500,
        e?.message || 'Failed to read Google Drive file'
      )
    }
  }
}
