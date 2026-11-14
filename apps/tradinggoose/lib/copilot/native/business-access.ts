import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { verifySavedEntityContext } from '@/lib/copilot/tools/server/entities/shared'
import { resolveOAuthCredentialAccountForUser } from '@/lib/credentials/oauth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { getMonitorRowById } from '@/app/api/monitors/shared'
import type { Pending, Scope } from './contract'
import { NativeTargetError } from './errors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export async function authorizeNativeCredential(
  scope: Scope,
  credentialId: string,
  businessWorkspaceId?: string
) {
  const resolved = await resolveOAuthCredentialAccountForUser({
    userId: scope.actorUserId,
    credentialId,
    ...(businessWorkspaceId ? { workspaceId: businessWorkspaceId } : {}),
  })
  if (
    !resolved ||
    resolved.credentialId !== credentialId ||
    resolved.providerId !== 'google-drive' ||
    (businessWorkspaceId !== undefined && resolved.workspaceId !== businessWorkspaceId)
  ) {
    throw new NativeTargetError(
      'Google Drive credential is no longer available in the authorized business scope',
      403
    )
  }
  return resolved
}

/** Fresh authorization only. Never re-executes a tool, refreshes credentials, or contacts a model. */
export async function authorizeNativeBusinessResult(
  scope: Scope,
  pending: Pending,
  result?: unknown,
  context?: Pick<
    ServerToolExecutionContext,
    'workspaceId' | 'contextEntityKind' | 'contextEntityId'
  >
) {
  const toolName = pending.target.toolName
  if (!isToolId(toolName)) throw new NativeTargetError('Unknown native tool', 422)
  const args = record(ToolArgSchemas[toolName].parse(pending.originalArgs))
  const output = record(result)
  const executionContext = { ...context, userId: scope.actorUserId }
  for (const workspaceId of new Set([args.workspaceId, output.workspaceId, context?.workspaceId])) {
    if (typeof workspaceId !== 'string') continue
    const access = await checkWorkspaceAccess(workspaceId, scope.actorUserId)
    if (!access.hasAccess)
      throw new NativeTargetError('Business workspace access has been revoked', 403)
  }
  if (toolName === 'gdrive_request_access') {
    if (typeof output.credentialId === 'string')
      await authorizeNativeCredential(scope, output.credentialId, context?.workspaceId)
    return
  }
  if (typeof args.credentialId === 'string')
    await authorizeNativeCredential(
      scope,
      args.credentialId,
      typeof args.workspaceId === 'string' ? args.workspaceId : context?.workspaceId
    )
  if (toolName === 'read_monitor' || toolName === 'edit_monitor') {
    if (typeof args.monitorId !== 'string')
      throw new NativeTargetError('Monitor target is required', 422)
    const monitor = await getMonitorRowById(args.monitorId)
    if (!monitor?.workflow.workspaceId)
      throw new NativeTargetError('Monitor is no longer available', 403)
    const access = await checkWorkspaceAccess(monitor.workflow.workspaceId, scope.actorUserId)
    if (!access.hasAccess) throw new NativeTargetError('Monitor access has been revoked', 403)
    return
  }
  if (toolName === 'read_workflow_logs' && typeof args.entityId === 'string') {
    const [log] = await db
      .select({ workspaceId: workflowExecutionLogs.workspaceId })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.id, args.entityId))
      .limit(1)
    if (log) {
      const access = await checkWorkspaceAccess(log.workspaceId, scope.actorUserId)
      if (!access.hasAccess)
        throw new NativeTargetError('Execution log access has been revoked', 403)
      return
    }
  }
  const kind = TOOL_PROMPT_METADATA[toolName].entityKind
  if (kind) {
    for (const entityId of new Set([args.entityId, output.entityId])) {
      if (typeof entityId === 'string')
        await verifySavedEntityContext(executionContext, kind, entityId, 'read')
    }
  }
}
