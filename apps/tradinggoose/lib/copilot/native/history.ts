import { readNativeCopilot } from './client'
import { COPILOT_NATIVE_REVISION, type HistoryMessage, type Scope, type Thread } from './contract'
import { authorizeNativeConversationScope, NativeTargetError } from './target'

/** Positive complete thread discovery is required before treating a canonical title as absent. */
export async function readNativeThread(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal
): Promise<Thread | undefined> {
  signal?.throwIfAborted()
  const authorized = await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  if (!threadId.trim()) throw new NativeTargetError('Native history thread is required', 422)
  const seen = new Set<string>()
  let found: Thread | undefined
  for (let page = 0; ; page++) {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(page))
      throw new NativeTargetError('Native thread pagination overflow', 503)
    const { status, result } = await readNativeCopilot(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: crypto.randomUUID(),
        scope: authorized,
        command: 'threads.list',
        page: { page, perPage: 100 },
      },
      signal
    )
    signal?.throwIfAborted()
    if (status !== 200 || result.status !== 'threads')
      throw new NativeTargetError('Native threads are unavailable', status >= 400 ? status : 503)
    if (
      result.page.page !== page ||
      result.page.perPage !== 100 ||
      result.items.length > 100 ||
      (result.hasMore && !result.items.length)
    )
      throw new NativeTargetError('Native thread pagination is inconsistent', 503)
    for (const thread of result.items) {
      if (seen.has(thread.id) || typeof thread.title !== 'string')
        throw new NativeTargetError('Native thread list is inconsistent', 503)
      seen.add(thread.id)
      if (thread.id === threadId) found = thread
    }
    if (!result.hasMore) return found
  }
}

/** Complete authorized native history. A failed page never becomes a successful prefix. */
export async function readNativeThreadHistory(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal
): Promise<HistoryMessage[]> {
  signal?.throwIfAborted()
  const authorized = await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  if (!threadId.trim()) throw new NativeTargetError('Native history thread is required', 422)
  const messages: HistoryMessage[] = []
  const seen = new Set<string>()
  let page = 0
  while (true) {
    signal?.throwIfAborted()
    const { status, result } = await readNativeCopilot(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: crypto.randomUUID(),
        scope: authorized,
        command: 'history.read',
        threadId,
        page: { page, perPage: 100 },
      },
      signal
    )
    signal?.throwIfAborted()
    if (status !== 200 || result.status !== 'history')
      throw new NativeTargetError('Native history is unavailable', status >= 400 ? status : 503)
    if (
      result.threadId !== threadId ||
      result.page.page !== page ||
      result.page.perPage !== 100 ||
      result.items.length > 100 ||
      (result.hasMore && result.items.length === 0)
    )
      throw new NativeTargetError('Native history pagination is inconsistent', 503)
    for (const message of result.items) {
      if (seen.has(message.id))
        throw new NativeTargetError('Native history contains a repeated message identity', 503)
      seen.add(message.id)
      messages.push(message)
    }
    if (!result.hasMore) return messages
    page += 1
    if (!Number.isSafeInteger(page))
      throw new NativeTargetError('Native history pagination overflow', 503)
  }
}
