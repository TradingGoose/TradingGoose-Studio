import { db } from '@tradinggoose/db'
import { account, credential, workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: typeof AuthType.SESSION | typeof AuthType.INTERNAL_JWT
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
  resolvedTokenAccountId?: string
}

/**
 * Centralizes OAuth credential authorization.
 * Credential IDs are workspace-scoped platform credentials. The underlying
 * account row is token storage and is never an authorization surface.
 */
export async function authorizeCredentialUse(
  request: NextRequest,
  params: {
    credentialId: string
    workflowId?: string
    workspaceId?: string
    requireWorkflowIdForInternal?: boolean
    callerUserId?: string
  }
): Promise<CredentialAccessResult> {
  const {
    credentialId,
    workflowId,
    workspaceId,
    requireWorkflowIdForInternal = true,
    callerUserId,
  } = params

  const auth = await checkSessionOrInternalAuth(request, {
    requireWorkflowId: requireWorkflowIdForInternal,
  })
  if (!auth.success || !auth.userId) {
    return { ok: false, error: auth.error || 'Authentication required' }
  }

  if (
    auth.authType === AuthType.INTERNAL_JWT &&
    callerUserId !== undefined &&
    callerUserId !== auth.userId
  ) {
    return { ok: false, error: 'Caller user does not match internal token subject' }
  }

  const actingUserId = auth.userId

  const [workflowContext] = workflowId
    ? await db
        .select({ workspaceId: workflowTable.workspaceId })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
    : [null]

  if (workflowId && (!workflowContext || !workflowContext.workspaceId)) {
    return { ok: false, error: 'Workflow not found' }
  }
  if (workflowContext && workspaceId && workflowContext.workspaceId !== workspaceId) {
    return { ok: false, error: 'Workflow is not in the requested workspace' }
  }

  const [platformCredential] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      accountId: credential.accountId,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!platformCredential) {
    return { ok: false, error: 'Credential not found' }
  }

  if (platformCredential.type !== 'oauth' || !platformCredential.accountId) {
    return { ok: false, error: 'Unsupported credential type for OAuth access' }
  }

  const scopedWorkspaceId = workflowContext?.workspaceId ?? workspaceId
  if (scopedWorkspaceId && scopedWorkspaceId !== platformCredential.workspaceId) {
    return { ok: false, error: 'Credential is not accessible from this workspace' }
  }

  const [accountRow] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, platformCredential.accountId))
    .limit(1)

  if (!accountRow) {
    return { ok: false, error: 'Credential account not found' }
  }

  const [requesterAccess, ownerAccess] = await Promise.all([
    checkWorkspaceAccess(platformCredential.workspaceId, actingUserId),
    checkWorkspaceAccess(platformCredential.workspaceId, accountRow.userId),
  ])

  if (!requesterAccess.hasAccess || !ownerAccess.hasAccess) {
    return { ok: false, error: 'Unauthorized' }
  }

  return {
    ok: true,
    authType: auth.authType as CredentialAccessResult['authType'],
    requesterUserId: actingUserId,
    credentialOwnerUserId: accountRow.userId,
    workspaceId: platformCredential.workspaceId,
    resolvedTokenAccountId: platformCredential.accountId,
  }
}
