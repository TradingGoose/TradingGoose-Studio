import { db } from '@tradinggoose/db'
import { account, workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: 'session' | 'api_key' | 'internal_jwt'
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
}

/**
 * Centralizes auth + collaboration rules for credential use.
 * - Uses checkHybridAuth to authenticate the caller
 * - Fetches credential owner
 * - Authorization rules:
 *   - session/api_key: allow if requester owns the credential; otherwise require workflowId and
 *     verify BOTH requester and owner have access to the workflow's workspace
 *   - internal_jwt: require workflowId and verify credential owner has access to the
 *     workflow's workspace (requester identity is the system/workflow)
 */
export async function authorizeCredentialUse(
  request: NextRequest,
  params: { credentialId: string; workflowId?: string }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId } = params

  const auth = await checkHybridAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return { ok: false, error: auth.error || 'Authentication required' }
  }
  const requesterUserId = auth.userId
  if (auth.authType !== 'internal_jwt' && !requesterUserId) {
    return { ok: false, error: 'Authentication required' }
  }
  if (auth.authType === 'internal_jwt' && !workflowId) {
    return { ok: false, error: 'workflowId is required' }
  }

  // Lookup credential owner
  const [credRow] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, credentialId))
    .limit(1)

  if (!credRow) {
    return { ok: false, error: 'Credential not found' }
  }

  const credentialOwnerUserId = credRow.userId

  // If requester owns the credential, allow immediately
  if (auth.authType !== 'internal_jwt' && requesterUserId === credentialOwnerUserId) {
    return {
      ok: true,
      authType: auth.authType,
      requesterUserId,
      credentialOwnerUserId,
    }
  }

  // For collaboration paths, workflowId is required to scope to a workspace
  if (!workflowId) {
    return { ok: false, error: 'workflowId is required' }
  }

  const [wf] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!wf || !wf.workspaceId) {
    return { ok: false, error: 'Workflow not found' }
  }

  if (auth.authType === 'internal_jwt') {
    // Internal calls: verify credential owner belongs to the workflow's workspace
    const ownerAccess = await checkWorkspaceAccess(wf.workspaceId, credentialOwnerUserId)
    if (!ownerAccess.hasAccess) {
      return { ok: false, error: 'Unauthorized' }
    }
    return {
      ok: true,
      authType: auth.authType,
      requesterUserId,
      credentialOwnerUserId,
      workspaceId: wf.workspaceId,
    }
  }

  if (!requesterUserId) {
    return { ok: false, error: 'Authentication required' }
  }

  // Session/API key: verify BOTH requester and owner belong to the workflow's workspace
  const [requesterAccess, ownerAccess] = await Promise.all([
    checkWorkspaceAccess(wf.workspaceId, requesterUserId),
    checkWorkspaceAccess(wf.workspaceId, credentialOwnerUserId),
  ])
  if (!requesterAccess.hasAccess || !ownerAccess.hasAccess) {
    return { ok: false, error: 'Unauthorized' }
  }

  return {
    ok: true,
    authType: auth.authType,
    requesterUserId,
    credentialOwnerUserId,
    workspaceId: wf.workspaceId,
  }
}
