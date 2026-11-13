import { listCopilotPending } from '@/lib/copilot/agent/service'
import { isToolId } from '@/lib/copilot/registry'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { Pending, Scope, Target } from './contract'
import { NativeTargetError } from './errors'
import { nativeConversationIdentity } from './identity'

/** Additional private preview state is read only from Mastra snapshots. */
export type ServerPending = Pending & { reviewBaseStateHash?: string }

export async function authorizeNativeConversationScope(
  actorUserId: string,
  workspaceId: string | null
): Promise<Scope> {
  if (!actorUserId.trim())
    throw new NativeTargetError('Authenticated Copilot actor is required', 401)
  if (workspaceId !== null) {
    if (!workspaceId.trim()) throw new NativeTargetError('Invalid conversation workspace', 422)
    if (!(await checkWorkspaceAccess(workspaceId, actorUserId)).hasAccess) {
      throw new NativeTargetError('Conversation workspace access denied', 403)
    }
  }
  return { actorUserId, workspaceId }
}

/** Native snapshots supply pending work; browser identifiers only select it. */
export async function resolveNativePendingTarget(
  scope: Scope,
  target: Target,
  stage: Pending['stage'],
  signal?: AbortSignal
): Promise<ServerPending> {
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  if (
    !isToolId(target.toolName) ||
    target.resourceId !== nativeConversationIdentity(scope).resourceId
  )
    throw new NativeTargetError('Copilot target does not belong to this conversation scope', 403)
  const items = await listCopilotPending(scope, target.threadId, signal)
  const match = items.find(
    (pending) => stableStringifyJsonValue(pending.target) === stableStringifyJsonValue(target)
  )
  if (!match || match.stage !== stage)
    throw new NativeTargetError('Copilot target is stale or at the wrong suspension stage', 409)
  return match
}
