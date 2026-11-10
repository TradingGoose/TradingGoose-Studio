import type { Scope } from './contract'

export function nativeConversationIdentity(scope: Scope) {
  const kind = scope.workspaceId === null ? 'personal' : 'workspace'
  const owner = scope.workspaceId ?? scope.actorUserId
  return {
    resourceId: JSON.stringify(['copilot', kind, owner, scope.actorUserId, scope.workspaceId]),
  }
}
