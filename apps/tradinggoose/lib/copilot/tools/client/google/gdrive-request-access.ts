import { CheckCircle, FolderOpen, Loader2, MinusCircle, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GDriveRequestAccessClientTool extends BaseClientTool {
  static readonly id = 'gdrive_request_access'

  constructor(toolCallId: string) {
    super(toolCallId, GDriveRequestAccessClientTool.id, GDriveRequestAccessClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Requesting GDrive access', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Requesting GDrive access', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Requesting GDrive access', icon: Loader2 },
      [ClientToolCallState.rejected]: { text: 'Skipped GDrive access', icon: MinusCircle },
      [ClientToolCallState.success]: { text: 'GDrive access granted', icon: CheckCircle },
      [ClientToolCallState.error]: { text: 'Failed to request GDrive access', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted GDrive access request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Select', icon: FolderOpen },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async execute(): Promise<void> {
    this.fail('Choose an authorized workspace and Google Drive credential in this tool card')
  }
}
