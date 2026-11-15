import { v5 as uuidv5 } from 'uuid'
import type { Scope, Target } from './contract'

/** Provider call IDs are local to a native run; Studio effects and cards need a stable identity. */
export function nativeToolCallId({
  runId,
  toolCallId,
}: Pick<Target, 'toolCallId'> & { runId?: string | null }) {
  if (!runId) throw new Error('Native tool call is missing its run ID')
  return uuidv5(JSON.stringify(['copilot-tool', runId, toolCallId]), uuidv5.URL)
}

export function nativeConversationIdentity(scope: Scope) {
  const kind = scope.workspaceId === null ? 'personal' : 'workspace'
  const owner = scope.workspaceId ?? scope.actorUserId
  return {
    resourceId: JSON.stringify(['copilot', kind, owner, scope.actorUserId, scope.workspaceId]),
  }
}
