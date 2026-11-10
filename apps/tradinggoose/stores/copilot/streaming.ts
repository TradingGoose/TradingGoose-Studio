import type {
  CopilotEvent,
  Pending,
  ReadyResponse,
  SuspendedResponse,
} from '@/lib/copilot/native/contract'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { withPinnedToolExecutionProvenance } from './store-provenance'
import { resolveToolDisplay } from './tool-registry'
import type {
  CopilotMessage,
  CopilotStore,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
} from './types'

type ContentBlock = NonNullable<CopilotMessage['contentBlocks']>[number]

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
  const updated = Object.fromEntries(
    Object.entries(state.toolCallsById).map(([id, call]) => [
      id,
      ids.has(id) &&
      !call.historical &&
      !call.pending &&
      call.result === undefined &&
      call.state === ClientToolCallState.generating
        ? {
            ...call,
            state: terminalState,
            display: resolveToolDisplay(call.name, terminalState, id, call.params),
          }
        : call,
    ])
  )
  return {
    toolCallsById: updated,
    messages: state.messages.map((message) => ({
      ...message,
      contentBlocks: message.contentBlocks?.map((block) =>
        block.type === 'tool_call' &&
        updated[block.toolCall.id] !== state.toolCallsById[block.toolCall.id]
          ? { ...block, toolCall: updated[block.toolCall.id] }
          : block
      ),
    })),
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

/** Parts are transient rendering state; only native history owns persisted conversation content. */
export function displayNativePending(
  state: CopilotStore,
  pending: Pending,
  provenance?: CopilotToolExecutionProvenance
): Pick<CopilotStore, 'toolCallsById' | 'messages'> {
  const target = pending.target
  if (
    !state.currentChat ||
    target.threadId !== state.currentChat.threadId ||
    pending.financialBinding.workspaceId !== state.currentChat.workspaceId ||
    pending.financialBinding.runId !== target.runId ||
    (pending.financialOccurrence.runId !== undefined &&
      pending.financialOccurrence.runId !== target.runId)
  )
    throw new Error('Native pending target scope differs')
  const current = state.toolCallsById[target.toolCallId]
  if (current && current.name !== target.toolName) throw new Error('Native tool identity differs')
  if (
    current?.pending &&
    ['target', 'originalArgs', 'financialBinding', 'financialOccurrence'].some(
      (key) =>
        stableStringifyJsonValue(current.pending![key as keyof Pending]) !==
        stableStringifyJsonValue(pending[key as keyof Pending])
    )
  )
    throw new Error('Original native pending target/arguments/binding changed')
  // An unfinished historical invocation is display-only. Fresh Pending restores its
  // action card; current attempt/error/review state and any known result stay intact.
  const stateToDisplay =
    current &&
    current.state !== ClientToolCallState.generating &&
    !(
      current.historical &&
      current.state === ClientToolCallState.aborted &&
      current.result === undefined &&
      current.resultProof === undefined
    )
      ? current.state
      : ClientToolCallState.pending
  const pendingCall: CopilotToolCall = {
    ...current,
    id: target.toolCallId,
    name: target.toolName,
    params: pending.originalArgs,
    pending,
    historical: false,
    historyOrigin: current?.historical || current?.historyOrigin ? true : undefined,
    state: stateToDisplay,
    display: resolveToolDisplay(
      target.toolName,
      stateToDisplay,
      target.toolCallId,
      pending.originalArgs
    ),
  }
  const toolCall = current
    ? pendingCall
    : withPinnedToolExecutionProvenance(pendingCall, provenance)
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
  const currentChat = { ...chat, latestTurnStatus: response.status, updatedAt: new Date() }
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
    lastNativeFinancial: response.financial,
  }
}

/** Every variant is from the generated closed contract; tool.display never dispatches. */
export function applyNativeEvent(
  state: CopilotStore,
  event: CopilotEvent,
  messageId: string,
  provenance?: CopilotToolExecutionProvenance
): Partial<CopilotStore> {
  switch (event.type) {
    case 'response.started':
      return { currentChat: verifyNativeThread(state, event), currentRunId: event.runId }
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
      const toolCall = withPinnedToolExecutionProvenance(
        {
          id: event.toolCallId,
          name: event.toolName,
          state: ClientToolCallState.generating,
          historical: false,
          display: resolveToolDisplay(
            event.toolName,
            ClientToolCallState.generating,
            event.toolCallId
          ),
        },
        provenance
      )
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
    case 'tool.pending':
      return {
        ...displayNativePending(state, event.pending, provenance),
        lastNativeFinancial: event.financial,
      }
    case 'response.completed':
      return applyNativeResponse(state, event.result, messageId)
    case 'response.suspended': {
      let next = { ...state, ...applyNativeResponse(state, event.result, messageId) }
      for (const pending of event.result.pending)
        next = { ...next, ...displayNativePending(next, pending, provenance) }
      return next
    }
    case 'response.refused':
    case 'response.error': {
      const display = settleDisplayOnlyTools(state, messageId, ClientToolCallState.error)
      return {
        toolCallsById: display.toolCallsById,
        lastNativeOutcome: event.result,
        ...(event.result.financial ? { lastNativeFinancial: event.result.financial } : {}),
        error: event.result.error.message,
        isSendingMessage: false,
        isAwaitingContinuation: false,
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
      return {
        ...settleDisplayOnlyTools(state, messageId),
        lastNativeOutcome: event.result,
        isAborting: false,
        isSendingMessage: false,
        isAwaitingContinuation: false,
      }
    case 'context.compacted':
      return {
        lastNativeOutcome: event.result,
        contextEvidence: null,
      }
  }
}
