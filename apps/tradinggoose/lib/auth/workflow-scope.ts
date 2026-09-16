import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type AuthResult, AuthType } from '@/lib/auth/hybrid'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

type WorkflowScopeResult =
  | { ok: true; userId: string; workspaceId: string; workflowId: string }
  | { ok: false; error: string; status: number }

/** Resolve workflow scope only after authenticating the request, never from a supplied owner ID. */
export async function authorizeWorkflowScope(
  auth: AuthResult,
  workflowId: string,
  access: 'read' | 'write'
): Promise<WorkflowScopeResult> {
  if (!auth.success || !auth.userId) return { ok: false, error: 'Unauthorized', status: 401 }
  if (!workflowId) return { ok: false, error: 'workflowId is required', status: 400 }

  const [row] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!row?.workspaceId) return { ok: false, error: 'Workflow not found', status: 404 }
  if (
    auth.authType === AuthType.API_KEY &&
    auth.apiKeyType === 'workspace' &&
    auth.workspaceId !== row.workspaceId
  ) {
    return { ok: false, error: 'Workflow is outside the API key workspace', status: 403 }
  }

  const userId = auth.userId
  const permission = await checkWorkspaceAccess(row.workspaceId, userId)
  if (!permission.hasAccess || (access === 'write' && !permission.canWrite)) {
    return { ok: false, error: 'Workflow access denied', status: 403 }
  }
  return { ok: true, userId, workspaceId: row.workspaceId, workflowId }
}
