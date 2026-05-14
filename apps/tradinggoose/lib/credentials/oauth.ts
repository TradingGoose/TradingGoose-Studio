import { db } from '@tradinggoose/db'
import { account, credential, credentialMember } from '@tradinggoose/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
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

type OAuthCredentialQueryParams = {
  userId: string
  workspaceId?: string
  providerIds?: string[]
}

type CredentialAccessRow = {
  credentialId: string
  credentialOwnerUserId: string
}

function readIdTokenDisplayName(idToken: string | null | undefined) {
  if (!idToken) return null
  const [, payload] = idToken.split('.')
  if (!payload) return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >
    const email =
      typeof decoded.email === 'string'
        ? decoded.email
        : typeof decoded.preferred_username === 'string'
          ? decoded.preferred_username
          : typeof decoded.upn === 'string'
            ? decoded.upn
            : null
    const name = typeof decoded.name === 'string' ? decoded.name : null
    if (name && email) return `${name} (${email})`
    return name || email
  } catch {
    return null
  }
}

function getCredentialDisplayName(row: {
  providerId: string
  accountId: string
  idToken?: string | null
}) {
  const identity = readIdTokenDisplayName(row.idToken) || row.accountId
  try {
    const serviceName = getServiceByProviderAndId(row.providerId as OAuthProvider).name
    return identity ? `${serviceName} (${identity})` : serviceName
  } catch {
    return identity || row.providerId
  }
}

function toOAuthCredential(row: {
  id: string
  displayName: string
  providerId: string
  updatedAt: Date
  scope: string | null
  accountUserId: string
  requesterUserId: string
}) {
  const storedScope = row.scope?.trim()
  const scopes = storedScope
    ? storedScope.split(/[\s,]+/).filter(Boolean)
    : getCanonicalScopesForProvider(row.providerId)
  const { baseProvider, featureType } = parseProvider(row.providerId as OAuthProvider)
  const isDefault = OAUTH_PROVIDERS[baseProvider]?.defaultService === featureType
  const isOwner = row.accountUserId === row.requesterUserId

  return {
    id: row.id,
    name: isOwner ? row.displayName : 'Saved by collaborator',
    provider: row.providerId as OAuthProvider,
    serviceId: featureType,
    lastUsed: row.updatedAt.toISOString(),
    isDefault,
    isOwner,
    scopes,
  } satisfies OAuthCredential
}

async function listUsableCredentialIds(params: {
  userId: string
  workspaceId: string
  canWrite: boolean
  rows: CredentialAccessRow[]
}) {
  if (params.rows.length === 0) return new Set<string>()

  const ownerIds = Array.from(new Set(params.rows.map((row) => row.credentialOwnerUserId)))
  const ownerAccess = new Map(
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        const access = await checkWorkspaceAccess(params.workspaceId, ownerId)
        return [ownerId, access.hasAccess] as const
      })
    )
  )
  const memberships = params.canWrite
    ? []
    : await db
        .select({ credentialId: credentialMember.credentialId })
        .from(credentialMember)
        .where(
          and(
            inArray(
              credentialMember.credentialId,
              params.rows.map((row) => row.credentialId)
            ),
            eq(credentialMember.userId, params.userId),
            eq(credentialMember.status, 'active')
          )
        )
  const sharedCredentialIds = new Set(memberships.map((row) => row.credentialId))

  return new Set(
    params.rows
      .filter(
        (row) =>
          ownerAccess.get(row.credentialOwnerUserId) === true &&
          (row.credentialOwnerUserId === params.userId ||
            params.canWrite ||
            sharedCredentialIds.has(row.credentialId))
      )
      .map((row) => row.credentialId)
  )
}

export async function listOAuthCredentialsForUser(
  params: OAuthCredentialQueryParams & {
    credentialId?: string
  }
) {
  if (!params.workspaceId) return []
  const requesterAccess = await checkWorkspaceAccess(params.workspaceId, params.userId)
  if (!requesterAccess.hasAccess) return []

  const filters = [eq(credential.type, 'oauth'), eq(credential.workspaceId, params.workspaceId)]
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
      accountUserId: account.userId,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .where(and(...filters))
    .orderBy(desc(account.updatedAt))

  const usableCredentialIds = await listUsableCredentialIds({
    userId: params.userId,
    workspaceId: params.workspaceId,
    canWrite: requesterAccess.canWrite,
    rows: rows.map((row) => ({
      credentialId: row.id,
      credentialOwnerUserId: row.accountUserId,
    })),
  })

  return rows
    .filter((row) => usableCredentialIds.has(row.id))
    .map((row) => toOAuthCredential({ ...row, requesterUserId: params.userId }))
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
        idToken: account.idToken,
        updatedAt: account.updatedAt,
        scope: account.scope,
        accountUserId: account.userId,
      })
      .from(account)
      .where(and(...filters))
      .orderBy(desc(account.updatedAt))
  ).filter((row) => !isSignInOAuthProviderId(row.providerId))

  return rows.map((row) =>
    toOAuthCredential({
      id: row.id,
      displayName: getCredentialDisplayName(row),
      providerId: row.providerId,
      updatedAt: row.updatedAt,
      scope: row.scope,
      accountUserId: row.accountUserId,
      requesterUserId: params.userId,
    })
  )
}

export async function listOAuthCredentialAccountsForUser(
  params: OAuthCredentialQueryParams & { workspaceId: string }
) {
  const requesterAccess = await checkWorkspaceAccess(params.workspaceId, params.userId)
  if (!requesterAccess.hasAccess) return []

  const filters = [eq(credential.type, 'oauth'), eq(credential.workspaceId, params.workspaceId)]
  if (params.providerIds?.length) {
    filters.push(inArray(account.providerId, params.providerIds))
  }

  const rows = await db
    .select({
      credentialId: credential.id,
      tokenAccountId: account.id,
      providerId: account.providerId,
      credentialOwnerUserId: account.userId,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .where(and(...filters))

  const usableCredentialIds = await listUsableCredentialIds({
    userId: params.userId,
    workspaceId: params.workspaceId,
    canWrite: requesterAccess.canWrite,
    rows,
  })

  return rows.filter((row) => usableCredentialIds.has(row.credentialId))
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
    .where(eq(credential.id, params.credentialId))
    .limit(1)

  if (!row || row.type !== 'oauth' || !row.accountId) {
    return null
  }
  if (params.workspaceId && row.workspaceId !== params.workspaceId) {
    return null
  }

  const requesterAccess = await checkWorkspaceAccess(row.workspaceId, params.userId)
  if (!requesterAccess.hasAccess) return null
  const usableCredentialIds = await listUsableCredentialIds({
    userId: params.userId,
    workspaceId: row.workspaceId,
    canWrite: requesterAccess.canWrite,
    rows: [{ credentialId: row.id, credentialOwnerUserId: row.accountUserId }],
  })
  if (!usableCredentialIds.has(row.id)) return null

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
  workspaceId: string
  requestId: string
}) {
  const [row] = await db
    .select({
      accountId: credential.accountId,
      accountUserId: account.userId,
      type: credential.type,
      workspaceId: credential.workspaceId,
    })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .where(eq(credential.id, params.credentialId))
    .limit(1)

  if (!row || row.type !== 'oauth' || !row.accountId) return null
  if (row.workspaceId !== params.workspaceId) return null

  const ownerAccess = await checkWorkspaceAccess(row.workspaceId, row.accountUserId)
  if (!ownerAccess.hasAccess) return null

  return refreshAccessTokenIfNeeded(row.accountId, row.accountUserId, params.requestId)
}
