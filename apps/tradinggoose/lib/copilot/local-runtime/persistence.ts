import { db } from '@tradinggoose/db'
import { and, asc, desc, eq, like, notLike } from 'drizzle-orm'
import { copilotReviewItems, copilotReviewSessions } from '@tradinggoose/db'
import type { LocalWorkingMessage } from '@/lib/copilot/local-runtime/working-messages'
import { LOCAL_COPILOT_MODEL_PREFIX } from '@/lib/copilot/local-runtime/runtime-models'

/**
 * Persistence for the local Copilot runtime's model working history.
 *
 * Rows live in the existing Copilot review tables so no schema migration is
 * needed:
 * - the assistant `tool_calls` message is stored as a `function_call` review
 *   item (`content` holds the call JSON), preserving transcript fidelity;
 * - each tool result is stored as a synthetic `tool_result` review item whose
 *   content is namespaced with `LOCAL_WORKING_PREFIX` and filtered out of the
 *   user-visible transcript and of the model's own conversation history.
 */
const LOCAL_WORKING_PREFIX = '[[local-working]]'
const TOOL_RESULT_ITEM_PREFIX = 'local_tool_result_'
const LOCAL_USER_ITEM_PREFIX = 'local_user_'
const LOCAL_ASSISTANT_ITEM_PREFIX = 'local_working_assistant_'
const FUNCTION_CALL_KIND = 'function_call'

type WorkingRow = { itemId: string; content: string }

function encodeWorkingValue(value: unknown): string {
  return `${LOCAL_WORKING_PREFIX}${JSON.stringify(value)}`
}

function decodeWorkingValue(content: string): unknown | null {
  if (!content?.startsWith(LOCAL_WORKING_PREFIX)) return null
  try {
    return JSON.parse(content.slice(LOCAL_WORKING_PREFIX.length))
  } catch {
    return null
  }
}

export function isLocalWorkingContent(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.startsWith(LOCAL_WORKING_PREFIX)
}

export function isLocalWorkingItemId(itemId: string | null | undefined): boolean {
  if (typeof itemId !== 'string') return false
  return (
    itemId.startsWith(TOOL_RESULT_ITEM_PREFIX) ||
    itemId.startsWith(LOCAL_USER_ITEM_PREFIX) ||
    itemId.startsWith(LOCAL_ASSISTANT_ITEM_PREFIX)
  )
}
/**
 * Review items synthesised for the local working state. These must be excluded
 * from the transcript handed to the model and from the user-visible thread.
 */
export function isLocalWorkingItem(row: {
  itemId?: string | null
  content?: string | null
}): boolean {
  return isLocalWorkingItemId(row.itemId) || isLocalWorkingContent(row.content)
}

/** Persists a single working message (assistant tool_calls or tool result). */
export async function persistLocalWorkingMessage(params: {
  reviewSessionId: string
  message: LocalWorkingMessage
}): Promise<void> {
  const { reviewSessionId, message } = params

  const [lastRow] = await db
    .select({ sequence: copilotReviewItems.sequence })
    .from(copilotReviewItems)
    .where(eq(copilotReviewItems.sessionId, reviewSessionId))
    .orderBy(desc(copilotReviewItems.sequence))
    .limit(1)

  const nextSequence =
    typeof lastRow?.sequence === 'number' ? lastRow.sequence + 1 : Date.now() % 1_000_000_000

  const isToolMessage = typeof message.tool_call_id === 'string' && !!message.tool_call_id
  const timestamp = new Date().toISOString()

  await db
    .insert(copilotReviewItems)
    .values({
      sessionId: reviewSessionId,
      turnId: null,
      sequence: nextSequence,
      itemId: isToolMessage
        ? `${TOOL_RESULT_ITEM_PREFIX}${message.tool_call_id}`
        : `local_tool_calls_${crypto.randomUUID()}`,
      kind: isToolMessage ? 'tool_result' : FUNCTION_CALL_KIND,
      messageRole: isToolMessage ? 'tool' : 'assistant',
      content: isToolMessage
        ? encodeWorkingValue({
            content: message.content ?? '',
            toolCallId: message.tool_call_id,
            ...(message.name ? { name: message.name } : {}),
          })
        : encodeWorkingValue({ tool_calls: message.tool_calls ?? [] }),
      timestamp,
      contentBlocks: [],
      contexts: [],
      fileAttachments: [],
      citations: [],
    })
    .onConflictDoNothing()
}

/**
 * Loads the working history for a session in insertion order, skipping the
 * user-authored transcript rows (those are rebuilt from the turn history).
 *
 * Returns `null` when nothing has been persisted yet.
 */
export async function loadLocalWorkingMessages(
  reviewSessionId: string
): Promise<LocalWorkingMessage[] | null> {
  const rows = await db
    .select({ itemId: copilotReviewItems.itemId, content: copilotReviewItems.content })
    .from(copilotReviewItems)
    .where(
      and(
        eq(copilotReviewItems.sessionId, reviewSessionId),
        like(copilotReviewItems.content, `${LOCAL_WORKING_PREFIX}%`)
      )
    )
    .orderBy(asc(copilotReviewItems.sequence))

  if (rows.length === 0) return null

  const messages: LocalWorkingMessage[] = []
  for (const row of rows as WorkingRow[]) {
    const decoded = decodeWorkingValue(row.content)
    if (!decoded || typeof decoded !== 'object') continue
    const record = decoded as Record<string, unknown>

    if (Array.isArray(record.tool_calls)) {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: record.tool_calls as LocalWorkingMessage['tool_calls'],
      })
      continue
    }

    if (typeof record.toolCallId === 'string') {
      messages.push({
        role: 'tool',
        tool_call_id: record.toolCallId,
        ...(typeof record.name === 'string' ? { name: record.name } : {}),
        content: typeof record.content === 'string' ? record.content : '',
      })
      continue
    }

    // Plain user/assistant text turns, written by persistLocalWorkingUserMessage
    // and persistLocalWorkingAssistantMessage. Without these the model would
    // only ever see the current turn.
    if (typeof record.text === 'string' && (record.role === 'user' || record.role === 'assistant')) {
      messages.push({ role: record.role, content: record.text })
    }
  }

  return messages.length > 0 ? messages : null
}

/**
 * Records the user's turn in the working history so later turns can replay it.
 * Idempotent per itemId, so a retried request cannot duplicate the turn.
 */
export async function persistLocalWorkingUserMessage(params: {
  reviewSessionId: string
  itemId: string
  text: string
}): Promise<void> {
  await appendWorkingRow(params.reviewSessionId, `${LOCAL_USER_ITEM_PREFIX}${params.itemId}`, {
    text: params.text,
    role: 'user',
  })
}

/**
 * Records the assistant's reply text in the working history. Called once per
 * completed turn; tool-call iterations are recorded separately.
 */
export async function persistLocalWorkingAssistantMessage(params: {
  reviewSessionId: string
  itemId: string
  text: string
}): Promise<void> {
  if (!params.text.trim()) return
  await appendWorkingRow(
    params.reviewSessionId,
    `${LOCAL_ASSISTANT_ITEM_PREFIX}${params.itemId}`,
    { text: params.text, role: 'assistant' }
  )
}

/** Inserts one namespaced working-history row at the end of the session. */
async function appendWorkingRow(
  reviewSessionId: string,
  itemId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const [lastRow] = await db
    .select({ sequence: copilotReviewItems.sequence })
    .from(copilotReviewItems)
    .where(eq(copilotReviewItems.sessionId, reviewSessionId))
    .orderBy(desc(copilotReviewItems.sequence))
    .limit(1)

  const nextSequence =
    typeof lastRow?.sequence === 'number' ? lastRow.sequence + 1 : Date.now() % 1_000_000_000

  await db
    .insert(copilotReviewItems)
    .values({
      sessionId: reviewSessionId,
      turnId: null,
      sequence: nextSequence,
      itemId,
      kind: 'message',
      messageRole: typeof payload.role === 'string' ? payload.role : 'assistant',
      content: encodeWorkingValue(payload),
      timestamp: new Date().toISOString(),
      contentBlocks: [],
      contexts: [],
      fileAttachments: [],
      citations: [],
    })
    .onConflictDoNothing()
}

/**
 * Appends the continuation tool result to the persisted working history.
 * Idempotent: a tool result for the same call id is never written twice.
 */
export async function persistLocalContinuation(params: {
  reviewSessionId: string
  toolCallId: string
  toolName: string
  status: number
  message?: unknown
  data?: unknown
}): Promise<void> {
  const existing = await db
    .select({ itemId: copilotReviewItems.itemId })
    .from(copilotReviewItems)
    .where(
      and(
        eq(copilotReviewItems.sessionId, params.reviewSessionId),
        eq(copilotReviewItems.itemId, `${TOOL_RESULT_ITEM_PREFIX}${params.toolCallId}`)
      )
    )
    .limit(1)

  if (existing.length > 0) return

  await persistLocalWorkingMessage({
    reviewSessionId: params.reviewSessionId,
    message: {
      role: 'tool',
      tool_call_id: params.toolCallId,
      name: params.toolName,
      content: JSON.stringify({
        ok: params.status >= 200 && params.status < 300,
        status: params.status,
        ...(params.message !== undefined ? { message: params.message } : {}),
        ...(params.data !== undefined ? { data: params.data } : {}),
      }),
    },
  })
}

/** Deletes the assistant tool_calls row for a turn that ended without tools. */
export async function deleteLocalWorkingMessage(
  reviewSessionId: string,
  itemId: string
): Promise<void> {
  await db
    .delete(copilotReviewItems)
    .where(
      and(eq(copilotReviewItems.sessionId, reviewSessionId), eq(copilotReviewItems.itemId, itemId))
    )
}

export async function clearLocalWorkingState(reviewSessionId: string): Promise<void> {
  await db
    .delete(copilotReviewItems)
    .where(
      and(
        eq(copilotReviewItems.sessionId, reviewSessionId),
        like(copilotReviewItems.content, `${LOCAL_WORKING_PREFIX}%`)
      )
    )
}

// ---------------------------------------------------------------- transcript --
// The user-visible assistant message is stored as a normal review item so the
// client renders local turns with the same code path as hosted ones.

/** Persists (or replaces) the assistant transcript item for a local turn. */
export async function persistLocalReviewMessage(params: {
  reviewSessionId: string
  itemId: string
  role: 'assistant' | 'user'
  content: string
}): Promise<void> {
  if (!params.content.trim()) return

  const existing = await db
    .select({ id: copilotReviewItems.id })
    .from(copilotReviewItems)
    .where(
      and(
        eq(copilotReviewItems.sessionId, params.reviewSessionId),
        eq(copilotReviewItems.itemId, params.itemId)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(copilotReviewItems)
      .set({ content: params.content })
      .where(eq(copilotReviewItems.id, existing[0].id))
    return
  }

  const [lastRow] = await db
    .select({ sequence: copilotReviewItems.sequence })
    .from(copilotReviewItems)
    .where(eq(copilotReviewItems.sessionId, params.reviewSessionId))
    .orderBy(desc(copilotReviewItems.sequence))
    .limit(1)

  const nextSequence =
    typeof lastRow?.sequence === 'number' ? lastRow.sequence + 1 : Date.now() % 1_000_000_000

  await db.insert(copilotReviewItems).values({
    sessionId: params.reviewSessionId,
    turnId: null,
    sequence: nextSequence,
    itemId: params.itemId,
    kind: 'message',
    messageRole: params.role,
    content: params.content,
    timestamp: new Date().toISOString(),
    contentBlocks: [],
    contexts: [],
    fileAttachments: [],
    citations: [],
  })
}

/**
 * Appends text to the most recent assistant transcript item of a session,
 * creating one when the continuation produced text before any was stored.
 */
export async function appendLocalAssistantText(
  reviewSessionId: string,
  text: string
): Promise<void> {
  if (!text.trim()) return

  const [latest] = await db
    .select({ id: copilotReviewItems.id, content: copilotReviewItems.content })
    .from(copilotReviewItems)
    .where(
      and(
        eq(copilotReviewItems.sessionId, reviewSessionId),
        eq(copilotReviewItems.messageRole, 'assistant'),
        eq(copilotReviewItems.kind, 'message'),
        notLike(copilotReviewItems.content, `${LOCAL_WORKING_PREFIX}%`)
      )
    )
    .orderBy(desc(copilotReviewItems.sequence))
    .limit(1)

  if (latest) {
    await db
      .update(copilotReviewItems)
      .set({ content: `${latest.content}${text}` })
      .where(eq(copilotReviewItems.id, latest.id))
    return
  }

  await persistLocalReviewMessage({
    reviewSessionId,
    itemId: `local_assistant_${crypto.randomUUID()}`,
    role: 'assistant',
    content: text,
  })
}

/**
 * Recovers the runtime model for a session from the stored item/session state.
 * Used by mark-complete, which the client sends without a model.
 */
export async function readLocalSessionModelFromMessage(
  reviewSessionId: string
): Promise<string | null> {
  const [session] = await db
    .select({ model: copilotReviewSessions.model })
    .from(copilotReviewSessions)
    .where(eq(copilotReviewSessions.id, reviewSessionId))
    .limit(1)

  const model = session?.model
  if (!model) return null
  return model.startsWith(LOCAL_COPILOT_MODEL_PREFIX)
    ? model.slice(LOCAL_COPILOT_MODEL_PREFIX.length)
    : model
}
