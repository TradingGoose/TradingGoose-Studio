interface ReplaySafetyToolCallLike {
  name?: string | null
  state?: string | null
  params?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
}

interface ReplaySafetyBlockLike {
  type?: string | null
  toolCall?: ReplaySafetyToolCallLike | null
}

export interface ReplaySafetyMessageLike {
  id: string
  toolCalls?: unknown
  contentBlocks?: unknown
}

export const EDIT_REPLAY_BLOCKED_MESSAGE =
  'Cannot edit a prompt that precedes accepted live changes.'

const ACCEPTED_WORKFLOW_MUTATION_STATES = new Set(['success', 'accepted'])
const ALWAYS_UNSAFE_LIVE_MUTATION_TOOL_NAMES = new Set([
  'edit_workflow',
  'set_global_workflow_variables',
])
const CONDITIONAL_ENTITY_MUTATION_TOOL_NAMES = new Set([
  'manage_skill',
  'manage_custom_tool',
  'manage_indicator',
  'manage_mcp_tool',
])

function asWorkflowToolCall(value: unknown): ReplaySafetyToolCallLike | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  return value as ReplaySafetyToolCallLike
}

function asToolCallBlock(value: unknown): ReplaySafetyBlockLike | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  return value as ReplaySafetyBlockLike
}

function getToolOperation(candidate: ReplaySafetyToolCallLike): string | null {
  const resultOperation = candidate.result?.operation
  if (typeof resultOperation === 'string' && resultOperation.trim().length > 0) {
    return resultOperation
  }

  const paramsOperation = candidate.params?.operation
  if (typeof paramsOperation === 'string' && paramsOperation.trim().length > 0) {
    return paramsOperation
  }

  return null
}

export function isAcceptedLiveMutationToolCall(toolCall: unknown): boolean {
  const candidate = asWorkflowToolCall(toolCall)
  if (!candidate) {
    return false
  }

  if (
    typeof candidate.state !== 'string' ||
    !ACCEPTED_WORKFLOW_MUTATION_STATES.has(candidate.state)
  ) {
    return false
  }

  if (candidate.name && ALWAYS_UNSAFE_LIVE_MUTATION_TOOL_NAMES.has(candidate.name)) {
    return true
  }

  if (candidate.name && CONDITIONAL_ENTITY_MUTATION_TOOL_NAMES.has(candidate.name)) {
    const operation = getToolOperation(candidate)
    return operation === null || operation === 'add' || operation === 'edit'
  }

  return false
}

export function messageHasAcceptedLiveMutation(message: ReplaySafetyMessageLike): boolean {
  if (Array.isArray(message.toolCalls)) {
    for (const toolCall of message.toolCalls) {
      if (isAcceptedLiveMutationToolCall(toolCall)) {
        return true
      }
    }
  }

  if (Array.isArray(message.contentBlocks)) {
    for (const block of message.contentBlocks) {
      const candidate = asToolCallBlock(block)
      if (candidate?.type !== 'tool_call') {
        continue
      }

      if (isAcceptedLiveMutationToolCall(candidate.toolCall)) {
        return true
      }
    }
  }

  return false
}

export function hasAcceptedLiveMutationAfterMessage(
  messages: ReplaySafetyMessageLike[],
  messageId: string
): boolean {
  const messageIndex = messages.findIndex((message) => message.id === messageId)
  if (messageIndex === -1) {
    return false
  }

  for (let index = messageIndex + 1; index < messages.length; index++) {
    if (messageHasAcceptedLiveMutation(messages[index])) {
      return true
    }
  }

  return false
}

export function dropsAcceptedLiveMutation(
  currentMessages: ReplaySafetyMessageLike[],
  nextMessages: Array<Pick<ReplaySafetyMessageLike, 'id'>>
): boolean {
  const nextMessageIds = new Set(nextMessages.map((message) => message.id))

  for (const message of currentMessages) {
    if (nextMessageIds.has(message.id)) {
      continue
    }

    if (messageHasAcceptedLiveMutation(message)) {
      return true
    }
  }

  return false
}
