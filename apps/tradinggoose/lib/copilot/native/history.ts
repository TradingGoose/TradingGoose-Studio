import { readNativeHistory } from '@/lib/mastra/agent-history'
import type { NativeHistoryMessage } from '@/lib/mastra/messages'
import { getNativeMemoryStore } from '@/lib/mastra/runtime'
import type { Scope, Thread } from './contract'
import { NativeTargetError } from './errors'
import { nativeConversationIdentity } from './identity'
import { authorizeNativeConversationScope } from './target'

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
): Promise<NativeHistoryMessage[]> {
  if (!(await readNativeThread(scope, threadId, signal)))
    throw new NativeTargetError('Copilot thread is unavailable', 404)
  return readNativeHistory(
    {
      threadId,
      resourceId: nativeConversationIdentity(scope).resourceId,
    },
    signal
  )
}
