import type { CopilotToolResultBinding } from '@/lib/copilot/result-proof'
import type { FinancialBinding, Pending, Scope } from './contract'

export function nativeConversationIdentity(scope: Scope) {
  const kind = scope.workspaceId === null ? 'personal' : 'workspace'
  const owner = scope.workspaceId ?? scope.actorUserId
  return {
    tenantId: JSON.stringify([kind, owner]),
    resourceId: JSON.stringify(['copilot', kind, owner, scope.actorUserId, scope.workspaceId]),
  }
}

export const nativeFinancialRootId = (binding: FinancialBinding) =>
  JSON.stringify([binding.namespace, binding.key, binding.fingerprint])

/** Use only after fresh native target, financial acceptance and business authorization checks. */
export function nativeResultBinding(scope: Scope, pending: Pending): CopilotToolResultBinding {
  return {
    actorId: scope.actorUserId,
    workspaceId: scope.workspaceId,
    ...nativeConversationIdentity(scope),
    threadId: pending.target.threadId,
    runId: pending.target.runId,
    toolCallId: pending.target.toolCallId,
    toolName: pending.target.toolName,
    financialRootId: nativeFinancialRootId(pending.financialBinding),
  }
}
