import { readNativeHistory } from '@/lib/mastra/agent-history'
import type { NativeHistoryMessage } from '@/lib/mastra/messages'
import { getNativeMemoryStore } from '@/lib/mastra/runtime'
import type { Scope } from './contract'
import { NativeTargetError } from './errors'
import { nativeConversationIdentity } from './identity'
import { authorizeNativeConversationScope } from './target'

export async function readNativeThread(scope: Scope, threadId: string, signal?: AbortSignal) {
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  signal?.throwIfAborted()
  const store = await getNativeMemoryStore()
  return store.getThreadById({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
}

export function publicCopilotMessage(message: NativeHistoryMessage): NativeHistoryMessage {
  // Public pending calls and previews are projected from the authorized snapshot.
  return {
    ...message,
    parts: message.parts.filter(
      (part) => part.type !== 'data-tool-call-suspended' && part.type !== 'data-tool-call-approval'
    ),
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
  return (
    await readNativeHistory(
      {
        threadId,
        resourceId: nativeConversationIdentity(scope).resourceId,
      },
      signal
    )
  ).map(publicCopilotMessage)
}
