import { copilotReviewItems, copilotReviewTurns } from '@tradinggoose/db/schema'

// This mirrors the Codex/Copilot conversation shape inside Studio's
// review-session envelope: one durable thread row, explicit turns, and an
// append-only item ledger that can later hold non-message review events.
export const REVIEW_ITEM_KINDS = {
  MESSAGE: 'message',
} as const

export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const

export type MessageRole = (typeof MESSAGE_ROLES)[keyof typeof MESSAGE_ROLES]
export type ReviewTurnRow = typeof copilotReviewTurns.$inferSelect
export type ReviewTurnInsert = typeof copilotReviewTurns.$inferInsert
export type ReviewItemRow = typeof copilotReviewItems.$inferSelect
export type ReviewItemInsert = typeof copilotReviewItems.$inferInsert

export interface ReviewMessageApi {
  id: string
  role: string
  content: string | null
  timestamp: string | null
  toolCalls?: unknown
  contentBlocks?: unknown
  contexts?: unknown
  fileAttachments?: unknown
  citations?: unknown
}

export interface ReviewMessageInput {
  id: string
  role: MessageRole | string
  content: string
  timestamp: string
  toolCalls?: unknown
  contentBlocks?: unknown
  contexts?: unknown
  fileAttachments?: unknown
  citations?: unknown
}

function normalizeArrayLike(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function normalizeMessageRole(role: string): MessageRole {
  if (role === MESSAGE_ROLES.USER) return MESSAGE_ROLES.USER
  if (role === MESSAGE_ROLES.SYSTEM) return MESSAGE_ROLES.SYSTEM
  return MESSAGE_ROLES.ASSISTANT
}

function buildContextsContentBlock(message: ReviewMessageInput) {
  if (message.role !== MESSAGE_ROLES.USER) {
    return undefined
  }

  const contexts = normalizeArrayLike(message.contexts)
  if (!contexts?.length) {
    return undefined
  }

  return [{ type: 'contexts', contexts, timestamp: Date.now() }]
}

function spreadIfArray<K extends string>(
  key: K,
  value: unknown
): { [P in K]: unknown[] } | Record<string, never> {
  const arr = normalizeArrayLike(value)
  return arr?.length ? ({ [key]: arr } as { [P in K]: unknown[] }) : ({} as Record<string, never>)
}

export function mapReviewItemToApi(item: {
  itemId: string
  messageRole: string
  content: string | null
  timestamp: string | null
  toolCalls?: unknown
  contentBlocks?: unknown
  contexts?: unknown
  fileAttachments?: unknown
  citations?: unknown
}): ReviewMessageApi {
  return {
    id: item.itemId,
    role: item.messageRole,
    content: item.content,
    timestamp: item.timestamp,
    ...spreadIfArray('toolCalls', item.toolCalls),
    ...spreadIfArray('contentBlocks', item.contentBlocks),
    ...spreadIfArray('contexts', item.contexts),
    ...spreadIfArray('fileAttachments', item.fileAttachments),
    ...spreadIfArray('citations', item.citations),
  }
}

export function countTurnsFromMessages(messages: ReviewMessageApi[]): number {
  let count = 0
  let hasOpenTurn = false

  for (const message of messages) {
    const role = normalizeMessageRole(message.role)
    if (!hasOpenTurn || role === MESSAGE_ROLES.USER) {
      hasOpenTurn = true
      count += 1
    }
  }

  return count
}

export function buildReviewItemInsert(params: {
  reviewSessionId: string
  turnId: string | null
  sequence: number
  message: ReviewMessageInput
}): ReviewItemInsert {
  const contextsContentBlock = buildContextsContentBlock(params.message)

  return {
    sessionId: params.reviewSessionId,
    turnId: params.turnId,
    sequence: params.sequence,
    itemId: params.message.id,
    kind: REVIEW_ITEM_KINDS.MESSAGE,
    messageRole: normalizeMessageRole(params.message.role),
    content: params.message.content,
    timestamp: params.message.timestamp,
    ...(normalizeArrayLike(params.message.toolCalls)
      ? { toolCalls: params.message.toolCalls as unknown[] }
      : {}),
    ...(normalizeArrayLike(params.message.contentBlocks)
      ? { contentBlocks: params.message.contentBlocks as unknown[] }
      : contextsContentBlock
        ? { contentBlocks: contextsContentBlock }
        : {}),
    ...(normalizeArrayLike(params.message.contexts)
      ? { contexts: params.message.contexts as unknown[] }
      : {}),
    ...(normalizeArrayLike(params.message.fileAttachments)
      ? { fileAttachments: params.message.fileAttachments as unknown[] }
      : {}),
    ...(normalizeArrayLike(params.message.citations)
      ? { citations: params.message.citations as unknown[] }
      : {}),
  }
}

export function deriveReviewTurnsAndItems(
  reviewSessionId: string,
  messages: ReviewMessageInput[]
): {
  turns: ReviewTurnInsert[]
  items: ReviewItemInsert[]
} {
  const turns: ReviewTurnInsert[] = []
  const items: ReviewItemInsert[] = []

  let currentTurnId: string | null = null
  let currentTurnIndex = -1
  let lastTurnTimestamp: string | null = null

  messages.forEach((message, itemIndex) => {
    const role = normalizeMessageRole(message.role)
    const shouldStartNewTurn = currentTurnId === null || role === MESSAGE_ROLES.USER

    if (shouldStartNewTurn) {
      currentTurnId = crypto.randomUUID()
      currentTurnIndex += 1
      lastTurnTimestamp = message.timestamp
      turns.push({
        id: currentTurnId,
        sessionId: reviewSessionId,
        sequence: currentTurnIndex,
        status: 'completed',
        userMessageItemId: role === MESSAGE_ROLES.USER ? message.id : null,
        ...(message.timestamp ? { createdAt: new Date(message.timestamp) } : {}),
        ...(message.timestamp ? { updatedAt: new Date(message.timestamp) } : {}),
        ...(message.timestamp ? { completedAt: new Date(message.timestamp) } : {}),
      })
    } else if (currentTurnId && currentTurnIndex >= 0) {
      lastTurnTimestamp = message.timestamp
      const currentTurn = turns[currentTurnIndex]
      turns[currentTurnIndex] = {
        ...currentTurn,
        ...(message.timestamp ? { updatedAt: new Date(message.timestamp) } : {}),
        ...(message.timestamp ? { completedAt: new Date(message.timestamp) } : {}),
      }
    }

    if (currentTurnId === null) {
      return
    }

    const currentTurn = turns[currentTurnIndex]
    if (role === MESSAGE_ROLES.USER && !currentTurn.userMessageItemId) {
      turns[currentTurnIndex] = {
        ...currentTurn,
        userMessageItemId: message.id,
        ...(lastTurnTimestamp ? { updatedAt: new Date(lastTurnTimestamp) } : {}),
      }
    }

    items.push(
      buildReviewItemInsert({
        reviewSessionId,
        turnId: currentTurnId,
        sequence: itemIndex,
        message,
      })
    )
  })

  return { turns, items }
}

export function buildAppendReviewTurn(params: {
  reviewSessionId: string
  existingMessages: ReviewMessageApi[]
  userMessage: ReviewMessageInput
  assistantMessage?: ReviewMessageInput | null
}): {
  turn: ReviewTurnInsert
  items: ReviewItemInsert[]
} {
  const nextTurnSequence = countTurnsFromMessages(params.existingMessages)
  const nextItemSequence = params.existingMessages.length
  const turnId = crypto.randomUUID()
  const firstTimestamp =
    params.userMessage.timestamp ??
    params.assistantMessage?.timestamp ??
    new Date().toISOString()
  const lastTimestamp =
    params.assistantMessage?.timestamp ?? params.userMessage.timestamp ?? firstTimestamp

  const items: ReviewItemInsert[] = [
    buildReviewItemInsert({
      reviewSessionId: params.reviewSessionId,
      turnId,
      sequence: nextItemSequence,
      message: params.userMessage,
    }),
  ]

  if (params.assistantMessage) {
    items.push(
      buildReviewItemInsert({
        reviewSessionId: params.reviewSessionId,
        turnId,
        sequence: nextItemSequence + 1,
        message: params.assistantMessage,
      })
    )
  }

  return {
    turn: {
      id: turnId,
      sessionId: params.reviewSessionId,
      sequence: nextTurnSequence,
      status: 'completed',
      userMessageItemId: params.userMessage.id,
      createdAt: new Date(firstTimestamp),
      updatedAt: new Date(lastTimestamp),
      completedAt: new Date(lastTimestamp),
    },
    items,
  }
}
