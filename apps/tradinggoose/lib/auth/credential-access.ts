import { db } from '@tradinggoose/db'
import {
  account,
  credential,
  credentialMember,
  workflow as workflowTable,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { AuthType, checkHybridAuth } from '@/lib/auth/hybrid'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: typeof AuthType.SESSION | typeof AuthType.INTERNAL_JWT | typeof AuthType.API_KEY
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
  resolvedTokenAccountId?: string
  resolvedProviderId?: string
}

export function credentialAuthStatus(error?: string) {
  if (!error || error === 'Authentication required') return 401
  if (error === 'Credential not found' || error === 'Workflow not found') return 404
  return 403
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
  }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId, workspaceId } = params

  const auth = await checkHybridAuth(request, {
    requireWorkflowId: false,
  })
  if (!auth.success) {
    return { ok: false, error: auth.error || 'Authentication required' }
  }
  const apiKeyWorkspaceId = auth.authType === AuthType.API_KEY ? auth.workspaceId : undefined

  if (!workflowId && !workspaceId && !apiKeyWorkspaceId) {
    return { ok: false, error: 'Credential scope is required' }
  }

  const [workflowContext] = workflowId
    ? await db
        .select({ userId: workflowTable.userId, workspaceId: workflowTable.workspaceId })
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
  if (workflowContext && apiKeyWorkspaceId && workflowContext.workspaceId !== apiKeyWorkspaceId) {
    return { ok: false, error: 'Credential is not accessible from this API key workspace' }
  }

  if (auth.authType === AuthType.INTERNAL_JWT && !auth.userId) {
    const tokenWorkflowId = auth.internalWorkflowExecution?.parentWorkflowId
    if (!workflowId || !tokenWorkflowId || tokenWorkflowId !== workflowId) {
      return { ok: false, error: 'Authentication required' }
    }
  }

  const actingUserId =
    auth.userId ??
    (auth.authType === AuthType.INTERNAL_JWT && workflowContext
      ? workflowContext.userId
      : undefined)
  if (!actingUserId) {
    return { ok: false, error: auth.error || 'Authentication required' }
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

  const scopedWorkspaceId = workflowContext?.workspaceId ?? apiKeyWorkspaceId ?? workspaceId
  if (scopedWorkspaceId && scopedWorkspaceId !== platformCredential.workspaceId) {
    return { ok: false, error: 'Credential is not accessible from this workspace' }
  }

  const [accountRow] = await db
    .select({ userId: account.userId, providerId: account.providerId })
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

  const requesterOwnsCredential = accountRow.userId === actingUserId
  const [credentialMembership] =
    requesterOwnsCredential || requesterAccess.canWrite
      ? [null]
      : await db
          .select({ id: credentialMember.id })
          .from(credentialMember)
          .where(
            and(
              eq(credentialMember.credentialId, platformCredential.id),
              eq(credentialMember.userId, actingUserId),
              eq(credentialMember.status, 'active')
            )
          )
          .limit(1)

  if (!requesterOwnsCredential && !requesterAccess.canWrite && !credentialMembership) {
    return { ok: false, error: 'Unauthorized' }
  }

  return {
    ok: true,
    authType: auth.authType as CredentialAccessResult['authType'],
    requesterUserId: actingUserId,
    credentialOwnerUserId: accountRow.userId,
    workspaceId: platformCredential.workspaceId,
    resolvedTokenAccountId: platformCredential.accountId,
    resolvedProviderId: accountRow.providerId,
  }
}
