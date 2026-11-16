'use client'

import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import type { CopilotState, CopilotToolCall } from '@/stores/copilot/types'

const UI_ACTIVE_TOOL_STATES = new Set<ClientToolCallState>([
  ClientToolCallState.generating,
  ClientToolCallState.pending,
  ClientToolCallState.executing,
  ClientToolCallState.review,
])

export function hasUiActiveToolCalls(toolCallsById: Record<string, CopilotToolCall>): boolean {
  return Object.values(toolCallsById).some(
    (toolCall) => !toolCall.historical && UI_ACTIVE_TOOL_STATES.has(toolCall.state)
  )
}

export function isCopilotBusy(state: CopilotState): boolean {
  return (
    state.isSendingMessage ||
    state.isAwaitingContinuation ||
    state.isAborting ||
    hasUiActiveToolCalls(state.toolCallsById)
  )
}
