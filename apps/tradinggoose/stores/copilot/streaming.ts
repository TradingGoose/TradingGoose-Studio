import type {
  CancelResponse,
  CopilotEvent,
  Pending,
  ReadyResponse,
  SuspendedResponse,
} from '@/lib/copilot/native/contract'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { isServerToolReviewRejectedResult } from '@/lib/copilot/tools/shared/review-result'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { updateMessageToolCalls } from './store-messages'
import { resolveToolDisplay } from './tool-registry'
import type { CopilotMessage, CopilotStore, CopilotToolCall } from './types'

type ContentBlock = NonNullable<CopilotMessage['contentBlocks']>[number]

function settleTools(
  state: CopilotStore,
  selected: (call: CopilotToolCall) => boolean,
  terminalState: ClientToolCallState
): Pick<CopilotStore, 'messages' | 'toolCallsById'> {
  const updated = Object.fromEntries(
    Object.entries(state.toolCallsById).map(([id, call]) => [
      id,
      !call.historical && selected(call)
        ? {
            ...call,
            state: terminalState,
            pending: undefined,
            display: resolveToolDisplay(call.name, terminalState, call.params),
          }
        : call,
    ])
  )
  return {
    toolCallsById: updated,
    messages: updateMessageToolCalls(state.messages, updated),
  }
}

/** Display events never authorize work. Settle only their obsolete visual activity. */
export function settleDisplayOnlyTools(
  state: CopilotStore,
  messageId?: string,
  terminalState = ClientToolCallState.aborted
): Pick<CopilotStore, 'messages' | 'toolCallsById'> {
  const ids = new Set(
    messageId
      ? state.messages.flatMap((message) =>
          message.id === messageId
            ? (message.contentBlocks ?? []).flatMap((block) =>
                block.type === 'tool_call' ? [block.toolCall.id] : []
              )
            : []
        )
      : Object.keys(state.toolCallsById)
  )
  return settleTools(
    state,
    (call) =>
      ids.has(call.id) &&
      !call.pending &&
      call.result === undefined &&
      call.state === ClientToolCallState.generating,
    terminalState
  )
}

export function applyNativeCancellation(
  state: CopilotStore,
  result: CancelResponse
): Partial<CopilotStore> {
  if (state.currentRunId !== result.runId) throw new Error('Native cancellation run differs')
  return {
    ...settleTools(
      state,
      (call) =>
        call.pending?.target.runId === result.runId ||
        (!call.pending && call.state === ClientToolCallState.generating),
      ClientToolCallState.aborted
    ),
    currentRunId: null,
    lastNativeOutcome: result,
    isAborting: false,
    isSendingMessage: false,
    isAwaitingContinuation: false,
  }
}
export function appendNativeText(message: CopilotMessage, type: 'text' | 'thinking', text: string) {
  const blocks = [...(message.contentBlocks ?? [])]
  const last = blocks.at(-1)
  if (last?.type === type) blocks[blocks.length - 1] = { ...last, content: last.content + text }
  else blocks.push({ type, content: text, timestamp: Date.now() })
  return {
    ...message,
    content: type === 'text' ? message.content + text : message.content,
    contentBlocks: blocks,
  }
}
export function replaceNativeText(message: CopilotMessage, text: string) {
  if (message.content === text) return message
  const retained = (message.contentBlocks ?? []).filter((block) => block.type !== 'text')
  const output: ContentBlock = { type: 'text', content: text, timestamp: Date.now() }
  return { ...message, content: text, contentBlocks: [...retained, output] }
}

export const samePendingOrigin = (left: Pending | undefined, right: Pending) =>
  !!left &&
  (['target', 'originalArgs', 'context'] as const).every(
    (field) => stableStringifyJsonValue(left[field]) === stableStringifyJsonValue(right[field])
  )

/** Parts are transient rendering state; only native history owns persisted conversation content. */
export function displayNativePending(
  state: CopilotStore,
  pending: Pending
): Pick<CopilotStore, 'toolCallsById' | 'messages'> {
  const target = pending.target
  if (!state.currentChat || target.threadId !== state.currentChat.threadId)
    throw new Error('Native pending target scope differs')
  const current = state.toolCallsById[target.toolCallId]
  if (current && current.name !== target.toolName) throw new Error('Native tool identity differs')
  if (current?.pending && !samePendingOrigin(current.pending, pending))
    throw new Error('Original Copilot pending target, arguments or context changed')
  // An unfinished historical invocation is display-only. Fresh Pending restores its
  // action card; current attempt/error/review state and any known result stay intact.
  const stateToDisplay =
    current &&
    current.state !== ClientToolCallState.generating &&
    !(
      current.historical &&
      current.state === ClientToolCallState.aborted &&
      current.result === undefined
    )
      ? current.state
      : ClientToolCallState.pending
  const selectedWorkspace =
    !pending.context?.workspaceId &&
    ['gdrive_request_access', 'oauth_request_access'].includes(target.toolName)
      ? current?.provenance?.workspaceId
      : undefined
  const toolCall: CopilotToolCall = {
    ...current,
    id: target.toolCallId,
    name: target.toolName,
    params: pending.originalArgs,
    pending,
    historical: false,
    historyOrigin: current?.historical || current?.historyOrigin ? true : undefined,
    state: pending.preview ? ClientToolCallState.review : stateToDisplay,
    ...(pending.preview ? { result: pending.preview } : {}),
    display: resolveToolDisplay(
      target.toolName,
      pending.preview ? ClientToolCallState.review : stateToDisplay,
      pending.originalArgs
    ),
    provenance: selectedWorkspace
      ? { ...pending.context, workspaceId: selectedWorkspace }
      : pending.context,
  }
  let found = false
  const messages = state.messages.map((message) => ({
    ...message,
    contentBlocks: message.contentBlocks?.map((block) => {
      if (block.type !== 'tool_call' || block.toolCall.id !== target.toolCallId) return block
      found = true
      return { ...block, toolCall }
    }),
  }))
  if (!found) {
    const last = messages.at(-1)
    const block: ContentBlock = { type: 'tool_call', toolCall, timestamp: Date.now() }
    if (last?.role === 'assistant')
      messages[messages.length - 1] = {
        ...last,
        contentBlocks: [...(last.contentBlocks ?? []), block],
      }
    else
      messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        contentBlocks: [block],
      })
  }
  return { toolCallsById: { ...state.toolCallsById, [toolCall.id]: toolCall }, messages }
}

export function verifyNativeThread(
  state: CopilotStore,
  value: { threadId: string; runId: string }
) {
  if (state.currentChat && state.currentChat.threadId !== value.threadId)
    throw new Error('Native response thread differs')
  if (state.currentRunId && state.currentRunId !== value.runId)
    throw new Error('Native response run differs')
  return (
    state.currentChat ?? {
      threadId: value.threadId,
      workspaceId: state.conversationWorkspaceId,
      title: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  )
}

export function applyNativeResponse(
  state: CopilotStore,
  response: ReadyResponse | SuspendedResponse,
  messageId: string
): Partial<CopilotStore> {
  const chat = verifyNativeThread(state, response)
  const currentChat = { ...chat, updatedAt: new Date() }
  const display = response.status === 'completed' ? settleDisplayOnlyTools(state, messageId) : state
  return {
    toolCallsById: display.toolCallsById,
    currentChat,
    chats: state.chats.some((item) => item.threadId === chat.threadId)
      ? state.chats.map((item) => (item.threadId === chat.threadId ? currentChat : item))
      : [currentChat, ...state.chats],
    currentRunId: response.status === 'completed' ? null : response.runId,
    messages: display.messages.map((message) =>
      message.id === messageId ? replaceNativeText(message, response.text) : message
    ),
    isSendingMessage: false,
    isAwaitingContinuation: response.status === 'suspended',
    lastNativeOutcome: response,
  }
}

/** Every variant is from the generated closed contract; tool.display never dispatches. */
export function applyNativeEvent(
  state: CopilotStore,
  event: CopilotEvent,
  messageId: string
): Partial<CopilotStore> {
  switch (event.type) {
    case 'response.started': {
      const index = state.messages.findIndex((message) => message.id === messageId) - 1
      if (event.messageId && (index < 0 || state.messages[index]?.role !== 'user'))
        throw new Error('Native response input message is unavailable')
      return {
        currentChat: verifyNativeThread(state, event),
        currentRunId: event.runId,
        messages: event.messageId
          ? state.messages.map((message, position) =>
              position === index ? { ...message, id: event.messageId! } : message
            )
          : state.messages,
      }
    }
    case 'text.delta':
    case 'reasoning.delta':
      return {
        messages: state.messages.map((message) =>
          message.id === messageId
            ? appendNativeText(
                message,
                event.type === 'text.delta' ? 'text' : 'thinking',
                event.text
              )
            : message
        ),
      }
    case 'tool.display': {
      const current = state.toolCallsById[event.toolCallId]
      if (current && current.name !== event.toolName)
        throw new Error('Native tool identity differs')
      if (current) return {}
      const toolCall: CopilotToolCall = {
        id: event.toolCallId,
        name: event.toolName,
        ...(event.args ? { params: event.args } : {}),
        state: ClientToolCallState.generating,
        historical: false,
        display: resolveToolDisplay(event.toolName, ClientToolCallState.generating, event.args),
      }
      return {
        toolCallsById: { ...state.toolCallsById, [toolCall.id]: toolCall },
        messages: state.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                contentBlocks: [
                  ...(message.contentBlocks ?? []),
                  { type: 'tool_call', toolCall, timestamp: Date.now() },
                ],
              }
            : message
        ),
      }
    }
    case 'tool.result': {
      const current = state.toolCallsById[event.toolCallId]
      if (current && current.name !== event.toolName)
        throw new Error('Copilot tool identity differs')
      const nextState = event.isError
        ? ClientToolCallState.error
        : event.denied || isServerToolReviewRejectedResult(event.toolName, event.result)
          ? ClientToolCallState.rejected
          : ClientToolCallState.success
      const toolCall: CopilotToolCall = {
        ...current,
        id: event.toolCallId,
        name: event.toolName,
        result: event.result,
        state: nextState,
        historical: false,
        pending: undefined,
        display: resolveToolDisplay(event.toolName, nextState, current?.params),
      }
      const toolCallsById = { ...state.toolCallsById, [toolCall.id]: toolCall }
      return { toolCallsById, messages: updateMessageToolCalls(state.messages, toolCallsById) }
    }
    case 'response.completed':
      return applyNativeResponse(state, event.result, messageId)
    case 'response.suspended': {
      let next = { ...state, ...applyNativeResponse(state, event.result, messageId) }
      for (const pending of event.result.pending)
        next = { ...next, ...displayNativePending(next, pending) }
      return next
    }
    case 'response.refused':
    case 'response.error': {
      const display = state.currentRunId
        ? state
        : settleDisplayOnlyTools(state, messageId, ClientToolCallState.error)
      return {
        toolCallsById: display.toolCallsById,
        lastNativeOutcome: event.result,
        error: event.result.error.message,
        isSendingMessage: Boolean(state.currentRunId),
        messages: display.messages.map((message) =>
          message.id === messageId
            ? {
                ...replaceNativeText(message, message.content || event.result.error.message),
                isError: true,
              }
            : message
        ),
      }
    }
    case 'response.cancel_requested':
      return applyNativeCancellation(state, event.result)
    default:
      throw new Error('Unknown Copilot event')
  }
}
