import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import {
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { workflowResumeJobId } from '@/lib/workflows/human-in-the-loop/types'
import type { Pending, Scope } from './contract'
import { NativeTargetError, ObserveResumedWorkflow } from './errors'
import { nativeToolCallId } from './identity'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function readAuthorizedWorkflowExecutionLog(
  scope: Scope,
  pending: Pending,
  context?: ServerToolExecutionContext
) {
  throwIfServerToolAborted(context)
  const args = ToolArgSchemas.run_workflow.parse(pending.originalArgs)
  const [row] = await db
    .select()
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, nativeToolCallId(pending.target)),
        eq(sql<string>`${workflowExecutionLogs.workflowSummary}->>'id'`, args.entityId)
      )
    )
    .limit(1)
  if (!row || row.executionId !== nativeToolCallId(pending.target))
    throw new NativeTargetError('Original workflow execution has no terminal result', 409)
  const environment = record(record(row.executionData).environment)
  if (
    !row.workspaceId?.trim() ||
    environment.workspaceId !== row.workspaceId ||
    environment.userId !== scope.actorUserId ||
    (context?.workspaceId !== undefined && context.workspaceId !== row.workspaceId) ||
    !(await checkWorkspaceAccess(row.workspaceId, scope.actorUserId)).hasAccess
  )
    throw new NativeTargetError('Original execution workspace access has been revoked', 403)
  throwIfServerToolAborted(context)
  if (!row.endedAt && !record(row.executionData).pause) {
    const checkpoint = record(record(row.executionData).checkpoint)
    if (
      row.workflowId === args.entityId &&
      typeof checkpoint.revision === 'number' &&
      Number.isSafeInteger(checkpoint.revision) &&
      checkpoint.revision > 0 &&
      checkpoint.activeJobId === workflowResumeJobId(row.executionId, checkpoint.revision)
    )
      throw new ObserveResumedWorkflow({
        workflowId: args.entityId,
        taskId: row.executionId,
        executionId: row.executionId,
      })
    throw new NativeTargetError('Original workflow execution has no terminal result', 409)
  }
  return row
}

export async function authorizeNativeCredential(
  scope: Scope,
  credentialId: string,
  businessWorkspaceId?: string
) {
  const { resolveOAuthCredentialAccountForUser } = await import('@/lib/credentials/oauth')
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
  const executionContext = { ...context, userId: scope.actorUserId }
  if (toolName === 'run_workflow' && result !== undefined) {
    await readAuthorizedWorkflowExecutionLog(scope, pending, executionContext)
    return
  }
  const args = record(ToolArgSchemas[toolName].parse(pending.originalArgs))
  const output = record(result)
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
    const { getMonitorRowById } = await import('@/app/api/monitors/shared')
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
      if (typeof entityId === 'string') {
        const { verifySavedEntityContext } = await import(
          '@/lib/copilot/tools/server/entities/shared'
        )
        await verifySavedEntityContext(executionContext, kind, entityId, 'read')
      }
    }
  }
}
