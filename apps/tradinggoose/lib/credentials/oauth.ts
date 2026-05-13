import { db } from '@tradinggoose/db'
import {
  account,
  credential,
  credentialMember,
  permissions,
  workspace,
} from '@tradinggoose/db/schema'
import { and, desc, eq, inArray, or } from 'drizzle-orm'
import {
  getCanonicalScopesForProvider,
  getServiceByProviderAndId,
  isSignInOAuthProviderId,
  OAUTH_PROVIDERS,
  type Credential as OAuthCredential,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/tokens'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

type SyncOAuthCredentialsParams = {
  userId: string
  workspaceId?: string
  providerIds?: string[]
}

function getPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const err = error as { code?: string; cause?: { code?: string } }
  return err.code || err.cause?.code
}

function getCredentialDisplayName(providerId: string, accountId: string) {
  try {
    return getServiceByProviderAndId(providerId as OAuthProvider).name
  } catch {
    return accountId || providerId
  }
}

function toOAuthCredential(row: {
  id: string
  displayName: string
  providerId: string
  updatedAt: Date
  scope: string | null
}): OAuthCredential {
  const storedScope = row.scope?.trim()
  const scopes = storedScope
    ? storedScope.split(/[\s,]+/).filter(Boolean)
    : getCanonicalScopesForProvider(row.providerId)
  const { baseProvider, featureType } = parseProvider(row.providerId as OAuthProvider)
  const isDefault = OAUTH_PROVIDERS[baseProvider]?.defaultService === featureType

  return {
    id: row.id,
    name: row.displayName,
    provider: row.providerId as OAuthProvider,
    serviceId: featureType,
    lastUsed: row.updatedAt.toISOString(),
    isDefault,
    scopes,
  }
}

async function listCredentialWorkspaceIds(userId: string, workspaceId?: string) {
  if (workspaceId) {
    const access = await checkWorkspaceAccess(workspaceId, userId)
    return access.hasAccess ? [workspaceId] : []
  }

  const rows = await db
    .select({ workspaceId: workspace.id })
    .from(workspace)
    .leftJoin(
      permissions,
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspace.id)
      )
    )
    .where(or(eq(workspace.ownerId, userId), eq(permissions.userId, userId)))

  return Array.from(new Set(rows.map((row) => row.workspaceId).filter(Boolean)))
}

async function insertCredentialMembership(params: {
  credentialId: string
  userId: string
  now: Date
}) {
  try {
    await db.insert(credentialMember).values({
      id: crypto.randomUUID(),
      credentialId: params.credentialId,
      userId: params.userId,
      role: 'admin',
      status: 'active',
      joinedAt: params.now,
      invitedBy: params.userId,
      createdAt: params.now,
      updatedAt: params.now,
    })
  } catch (error) {
    if (getPostgresErrorCode(error) !== '23505') throw error
    await db
      .update(credentialMember)
      .set({
        role: 'admin',
        status: 'active',
        joinedAt: params.now,
        invitedBy: params.userId,
        updatedAt: params.now,
      })
      .where(
        and(
          eq(credentialMember.credentialId, params.credentialId),
          eq(credentialMember.userId, params.userId)
        )
      )
  }
}

export async function syncOAuthCredentialsForUser(params: SyncOAuthCredentialsParams) {
  if (!params.workspaceId) return

  const providerIds = params.providerIds?.map((providerId) => providerId.trim()).filter(Boolean)
  const accountFilters = [eq(account.userId, params.userId)]
  if (providerIds?.length) {
    accountFilters.push(inArray(account.providerId, providerIds))
  }

  const accounts = (
    await db
      .select({
        id: account.id,
        providerId: account.providerId,
        accountId: account.accountId,
      })
      .from(account)
      .where(and(...accountFilters))
  ).filter((row) => !isSignInOAuthProviderId(row.providerId))
  if (accounts.length === 0) return

  const workspaceIds = await listCredentialWorkspaceIds(params.userId, params.workspaceId)
  if (workspaceIds.length === 0) return

  const now = new Date()
  const accountIds = accounts.map((row) => row.id)
  for (const workspaceId of workspaceIds) {
    const existingCredentials = await db
      .select({
        id: credential.id,
        accountId: credential.accountId,
      })
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'oauth'),
          inArray(credential.accountId, accountIds)
        )
      )

    const credentialIdByAccountId = new Map(
      existingCredentials
        .filter((row) => typeof row.accountId === 'string')
        .map((row) => [row.accountId!, row.id])
    )

    for (const accountRow of accounts) {
      let credentialId = credentialIdByAccountId.get(accountRow.id)
      if (!credentialId) {
        credentialId = crypto.randomUUID()
        try {
          await db.insert(credential).values({
            id: credentialId,
            workspaceId,
            type: 'oauth',
            displayName: getCredentialDisplayName(accountRow.providerId, accountRow.accountId),
            description: null,
            providerId: accountRow.providerId,
            accountId: accountRow.id,
            envKey: null,
            envOwnerUserId: null,
            encryptedServiceAccountKey: null,
            createdBy: params.userId,
            createdAt: now,
            updatedAt: now,
          })
        } catch (error) {
          if (getPostgresErrorCode(error) !== '23505') throw error
          const [row] = await db
            .select({ id: credential.id })
            .from(credential)
            .where(
              and(
                eq(credential.workspaceId, workspaceId),
                eq(credential.type, 'oauth'),
                eq(credential.accountId, accountRow.id)
              )
            )
            .limit(1)
          if (!row) throw error
          credentialId = row.id
        }
      }

      await insertCredentialMembership({
        credentialId,
        userId: params.userId,
        now,
      })
    }
  }
}

export async function listOAuthCredentialsForUser(
  params: SyncOAuthCredentialsParams & {
    credentialId?: string
  }
) {
  await syncOAuthCredentialsForUser(params)
  const workspaceIds = await listCredentialWorkspaceIds(params.userId, params.workspaceId)
  if (workspaceIds.length === 0) return []

  const filters = [
    eq(credential.type, 'oauth'),
    eq(credentialMember.userId, params.userId),
    eq(credentialMember.status, 'active'),
    inArray(credential.workspaceId, workspaceIds),
  ]
  if (params.providerIds?.length) {
    filters.push(inArray(account.providerId, params.providerIds))
  }
  if (params.credentialId?.trim()) {
    filters.push(eq(credential.id, params.credentialId.trim()))
  }

  const rows = await db
    .select({
      id: credential.id,
      accountId: account.id,
      displayName: credential.displayName,
      providerId: account.providerId,
      updatedAt: account.updatedAt,
      scope: account.scope,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .innerJoin(credentialMember, eq(credentialMember.credentialId, credential.id))
    .where(and(...filters))
    .orderBy(desc(account.updatedAt))

  const credentialRows = params.workspaceId
    ? rows
    : Array.from(new Map(rows.map((row) => [row.accountId, row])).values())
  return credentialRows.map(toOAuthCredential)
}

export async function listOAuthConnectionsForUser(params: {
  userId: string
  providerIds?: string[]
}) {
  const providerIds = params.providerIds?.map((providerId) => providerId.trim()).filter(Boolean)
  const filters = [eq(account.userId, params.userId)]
  if (providerIds?.length) {
    filters.push(inArray(account.providerId, providerIds))
  }

  const rows = (
    await db
      .select({
        id: account.id,
        accountId: account.accountId,
        providerId: account.providerId,
        updatedAt: account.updatedAt,
        scope: account.scope,
      })
      .from(account)
      .where(and(...filters))
      .orderBy(desc(account.updatedAt))
  ).filter((row) => !isSignInOAuthProviderId(row.providerId))

  return rows.map((row) =>
    toOAuthCredential({
      id: row.id,
      displayName: getCredentialDisplayName(row.providerId, row.accountId),
      providerId: row.providerId,
      updatedAt: row.updatedAt,
      scope: row.scope,
    })
  )
}

export async function listOAuthCredentialAccountsForUser(
  params: SyncOAuthCredentialsParams & { workspaceId: string }
) {
  await syncOAuthCredentialsForUser(params)
  const workspaceIds = await listCredentialWorkspaceIds(params.userId, params.workspaceId)
  if (workspaceIds.length === 0) return []

  const filters = [
    eq(credential.type, 'oauth'),
    eq(credentialMember.userId, params.userId),
    eq(credentialMember.status, 'active'),
    inArray(credential.workspaceId, workspaceIds),
  ]
  if (params.providerIds?.length) {
    filters.push(inArray(account.providerId, params.providerIds))
  }

  return db
    .select({
      credentialId: credential.id,
      tokenAccountId: account.id,
      providerId: account.providerId,
      credentialOwnerUserId: account.userId,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .innerJoin(credentialMember, eq(credentialMember.credentialId, credential.id))
    .where(and(...filters))
}

export async function resolveOAuthCredentialAccountForUser(params: {
  credentialId: string
  userId: string
  workspaceId?: string
}) {
  const [row] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      accountId: credential.accountId,
      accountUserId: account.userId,
      providerId: account.providerId,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .innerJoin(
      credentialMember,
      and(
        eq(credentialMember.credentialId, credential.id),
        eq(credentialMember.userId, params.userId),
        eq(credentialMember.status, 'active')
      )
    )
    .where(eq(credential.id, params.credentialId))
    .limit(1)

  if (!row || row.type !== 'oauth' || !row.accountId) {
    return null
  }
  if (params.workspaceId && row.workspaceId !== params.workspaceId) {
    return null
  }

  const [requesterAccess, ownerAccess] = await Promise.all([
    checkWorkspaceAccess(row.workspaceId, params.userId),
    checkWorkspaceAccess(row.workspaceId, row.accountUserId),
  ])
  if (!requesterAccess.hasAccess || !ownerAccess.hasAccess) {
    return null
  }

  return {
    credentialId: row.id,
    accountId: row.accountId,
    credentialOwnerUserId: row.accountUserId,
    providerId: row.providerId,
    workspaceId: row.workspaceId,
  }
}

export async function getOAuthAccessTokenForUserCredential(params: {
  credentialId: string
  userId: string
  requestId: string
  workspaceId?: string
}) {
  const resolved = await resolveOAuthCredentialAccountForUser(params)
  if (!resolved) return null

  return refreshAccessTokenIfNeeded(
    resolved.accountId,
    resolved.credentialOwnerUserId,
    params.requestId
  )
}

export async function getOAuthAccessTokenForStoredCredential(params: {
  credentialId: string
  requestId: string
}) {
  const [row] = await db
    .select({
      accountId: credential.accountId,
      accountUserId: account.userId,
      type: credential.type,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .where(eq(credential.id, params.credentialId))
    .limit(1)

  if (!row || row.type !== 'oauth' || !row.accountId) return null
  return refreshAccessTokenIfNeeded(row.accountId, row.accountUserId, params.requestId)
}
