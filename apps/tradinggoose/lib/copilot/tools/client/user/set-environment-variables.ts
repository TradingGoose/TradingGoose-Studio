import { Loader2, Settings2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SetEnvironmentVariablesClientTool extends BaseClientTool {
  static readonly id = 'set_environment_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      SetEnvironmentVariablesClientTool.id,
      SetEnvironmentVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to set environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set environment variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Setting environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Set environment variables', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to set environment variables', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted setting environment variables',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped setting environment variables',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
    },
  }
}
