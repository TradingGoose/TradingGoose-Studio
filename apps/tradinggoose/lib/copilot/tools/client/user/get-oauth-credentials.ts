import { Key, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetOAuthCredentialsClientTool extends BaseClientTool {
  static readonly id = 'get_oauth_credentials'

  constructor(toolCallId: string) {
    super(toolCallId, GetOAuthCredentialsClientTool.id, GetOAuthCredentialsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching OAuth credentials', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching OAuth credentials', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Retrieving login IDs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved login IDs', icon: Key },
      [ClientToolCallState.error]: { text: 'Failed to retrieve login IDs', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted fetching OAuth credentials',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped fetching OAuth credentials',
        icon: MinusCircle,
      },
    },
  }
}
