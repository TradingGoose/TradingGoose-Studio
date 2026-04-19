import { KeyRound, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetEnvironmentVariablesClientTool extends BaseClientTool {
  static readonly id = 'get_environment_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      GetEnvironmentVariablesClientTool.id,
      GetEnvironmentVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Reading environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read environment variables', icon: KeyRound },
      [ClientToolCallState.error]: { text: 'Failed to read environment variables', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading environment variables',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading environment variables',
        icon: MinusCircle,
      },
    },
  }
}
