import { FolderOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class ListGDriveFilesClientTool extends BaseClientTool {
  static readonly id = 'list_gdrive_files'

  constructor(toolCallId: string) {
    super(toolCallId, ListGDriveFilesClientTool.id, ListGDriveFilesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Listed GDrive files', icon: FolderOpen },
      [ClientToolCallState.error]: { text: 'Failed to list GDrive files', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing GDrive files', icon: MinusCircle },
    },
  }
}
