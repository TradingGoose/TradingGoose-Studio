'use client'

import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { copilotToolSupportsState } from '@/stores/copilot/tool-registry'
import type { CopilotChat, CopilotStore, CopilotToolCall } from '@/stores/copilot/types'

export const ACTIVE_TURN_STATUS = 'in_progress'
export const COMPLETED_TURN_STATUS = 'completed'

const VALID_TOOL_CALL_STATES = new Set<string>(Object.values(ClientToolCallState))
const RUNTIME_ACTIVE_TOOL_STATES = new Set<ClientToolCallState>([
  ClientToolCallState.generating,
  ClientToolCallState.pending,
  ClientToolCallState.executing,
  ClientToolCallState.background,
])
const UI_ACTIVE_TOOL_STATES = new Set<ClientToolCallState>([
  ...RUNTIME_ACTIVE_TOOL_STATES,
  ClientToolCallState.review,
])

export function normalizeReloadedToolState(
  toolName: string | undefined,
  state: unknown,
  latestTurnStatus?: string | null,
  accessLevel?: CopilotStore['accessLevel']
): ClientToolCallState {
  const nextState =
    typeof state === 'string' && VALID_TOOL_CALL_STATES.has(state)
      ? (state as ClientToolCallState)
      : ClientToolCallState.rejected

  if (
    nextState === ClientToolCallState.generating ||
    nextState === ClientToolCallState.executing
  ) {
    if (latestTurnStatus === ACTIVE_TURN_STATUS) {
      return nextState
    }
    if (accessLevel !== 'full' && nextState === ClientToolCallState.executing) {
      if (copilotToolSupportsState(toolName, ClientToolCallState.review)) {
        return ClientToolCallState.review
      }
    }
    return ClientToolCallState.aborted
  }

  return nextState
}

export function isChatTurnInProgress(
  chat: Pick<CopilotChat, 'latestTurnStatus'> | null | undefined
): boolean {
  return chat?.latestTurnStatus === ACTIVE_TURN_STATUS
}

export function isToolCallRuntimeActive(
  state: CopilotToolCall['state'] | undefined
): boolean {
  return state != null && RUNTIME_ACTIVE_TOOL_STATES.has(state)
}

export function isToolCallUiActive(
  state: CopilotToolCall['state'] | undefined
): boolean {
  return state != null && UI_ACTIVE_TOOL_STATES.has(state)
}

export function hasUiActiveToolCalls(
  toolCallsById: Record<string, CopilotToolCall>
): boolean {
  return Object.values(toolCallsById).some((toolCall) => isToolCallUiActive(toolCall.state))
}

export function buildChatTurnStatusState(
  state: Pick<CopilotStore, 'currentChat' | 'chats'>,
  latestTurnStatus: string
): Pick<CopilotStore, 'currentChat' | 'chats'> {
  const currentChat = state.currentChat
  if (!currentChat) {
    return {
      currentChat,
      chats: state.chats,
    }
  }

  return {
    currentChat: {
      ...currentChat,
      latestTurnStatus,
    },
    chats: state.chats.map((chat) =>
      chat.reviewSessionId === currentChat.reviewSessionId ? { ...chat, latestTurnStatus } : chat
    ),
  }
}

export function resolveTurnStatusFromToolCalls(
  toolCallsById: Record<string, CopilotToolCall>
): string {
  const hasActiveToolCall = Object.values(toolCallsById).some((toolCall) =>
    isToolCallRuntimeActive(toolCall.state)
  )

  return hasActiveToolCall ? ACTIVE_TURN_STATUS : COMPLETED_TURN_STATUS
}

export function resolveStreamPausedTurnStatus(
  toolCallsById: Record<string, CopilotToolCall>,
  awaitingTools: boolean
): string {
  if (awaitingTools && Object.keys(toolCallsById).length === 0) {
    return ACTIVE_TURN_STATUS
  }

  return resolveTurnStatusFromToolCalls(toolCallsById)
}

export function resolveStoreTurnActivityState(
  state: Pick<CopilotStore, 'isAwaitingContinuation'>,
  toolCallsById: Record<string, CopilotToolCall>
): string {
  return state.isAwaitingContinuation ? ACTIVE_TURN_STATUS : resolveTurnStatusFromToolCalls(toolCallsById)
}
