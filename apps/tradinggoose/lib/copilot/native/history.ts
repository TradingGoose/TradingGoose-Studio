import { getNativeMemoryStore } from '@/lib/mastra/runtime'
import type { HistoryMessage, Scope, Thread } from './contract'
import { nativeConversationIdentity } from './identity'
import { authorizeNativeConversationScope, NativeTargetError } from './target'

export async function readNativeThread(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal
): Promise<Thread | undefined> {
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  signal?.throwIfAborted()
  const store = await getNativeMemoryStore()
  const thread = await store.getThreadById({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  if (!thread) return undefined
  return {
    id: thread.id,
    title: thread.title ?? '',
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  }
}

/** Native parts stay in storage unchanged; this projection is only for rendering. */
export async function readNativeThreadHistory(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal
): Promise<HistoryMessage[]> {
  if (!(await readNativeThread(scope, threadId, signal)))
    throw new NativeTargetError('Copilot thread is unavailable', 404)
  const store = await getNativeMemoryStore()
  const result = await store.listMessages({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
    perPage: false,
    orderBy: { field: 'createdAt', direction: 'ASC' },
  })
  signal?.throwIfAborted()
  return result.messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt.toISOString(),
    parts: message.content.parts as HistoryMessage['parts'],
  }))
}
