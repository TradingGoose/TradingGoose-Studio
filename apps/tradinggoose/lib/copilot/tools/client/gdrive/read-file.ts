import { FileText, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

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
}
