import { db } from '@tradinggoose/db'
import {
  credential as credentialTable,
  webhook as webhookTable,
  workflow as workflowTable,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import {
  getOAuthAccessTokenForStoredCredential,
  getOAuthAccessTokenForUserCredential,
} from '@/lib/credentials/oauth'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const teamsLogger = createLogger('TeamsSubscription')
const webflowLogger = createLogger('WebflowSubscription')
const telegramLogger = createLogger('TelegramWebhook')
const airtableLogger = createLogger('AirtableWebhook')
const MICROSOFT_TEAMS_CHAT_CALLBACK_PATH =
  /^microsoftteams-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
type AirtableWebhookCleanup = {
  baseId: string
  externalId: string
  credentialId: string
}
export class AirtableWebhookRejectedError extends Error {}
export class WebhookRevisionConflictError extends Error {}
export class ExternalSubscriptionCredentialUnavailableError extends Error {}
const EXTERNAL_SUBSCRIPTION_CREDENTIAL_LOCK_NAMESPACE = 29_403

export const generateMicrosoftTeamsChatCallbackPath = () => `microsoftteams-${crypto.randomUUID()}`
export const isMicrosoftTeamsChatCallbackPath = (path: string) =>
  MICROSOFT_TEAMS_CHAT_CALLBACK_PATH.test(path)

const toConfig = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const collectCredentialIds = (value: unknown, result: Set<string>) => {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const entry of value) collectCredentialIds(entry, result)
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'credentialId' && typeof entry === 'string' && entry.trim()) {
      result.add(entry.trim())
    } else {
      collectCredentialIds(entry, result)
    }
  }
}

export function getExternalSubscriptionCredentialIds(
  value: Pick<typeof webhookTable.$inferSelect, 'provider' | 'providerConfig'>
) {
  const config = toConfig(value.providerConfig)
  const ownsExternalSubscription =
    value.provider === 'airtable' ||
    value.provider === 'webflow' ||
    (value.provider === 'microsoftteams' && config.triggerId === 'microsoftteams_chat_subscription')
  if (!ownsExternalSubscription) return []
  const credentialIds = new Set<string>()
  collectCredentialIds(config, credentialIds)
  return [...credentialIds].sort()
}

export function getExternalSubscriptionDeclarativeConfig(provider: unknown, value: unknown) {
  const config = toConfig(value)
  if (provider === 'webflow') {
    const { externalId: _externalId, ...declarative } = config
    return declarative
  }
  if (provider === 'microsoftteams') {
    const {
      externalSubscriptionId: _externalSubscriptionId,
      subscriptionExpiration: _subscriptionExpiration,
      ...declarative
    } = config
    return declarative
  }
  return config
}

export async function lockExternalSubscriptionCredentials(tx: any, credentialIds: string[]) {
  const ids = [...new Set(credentialIds.map((id) => id.trim()).filter(Boolean))].sort()
  for (const id of ids) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${EXTERNAL_SUBSCRIPTION_CREDENTIAL_LOCK_NAMESPACE}, hashtext(${id}))`
    )
  }
  if (!ids.length) return
  const rows = await tx
    .select({ id: credentialTable.id })
    .from(credentialTable)
    .where(inArray(credentialTable.id, ids))
  if (rows.length !== ids.length) {
    throw new ExternalSubscriptionCredentialUnavailableError(
      'External subscription credential is no longer available'
    )
  }
}
export function getWebhookRevision(
  current: Pick<typeof webhookTable.$inferSelect, 'id' | 'updatedAt'>,
  ...conditions: SQL[]
) {
  return {
    updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
    where: and(
      eq(webhookTable.id, current.id),
      eq(webhookTable.updatedAt, current.updatedAt),
      ...conditions
    ),
  }
}
export function getWebhookSnapshotRevision(
  current: Pick<typeof webhookTable.$inferSelect, 'id' | 'updatedAt' | 'provider' | 'isActive'>,
  ...conditions: SQL[]
) {
  return getWebhookRevision(
    current,
    current.provider === null
      ? isNull(webhookTable.provider)
      : eq(webhookTable.provider, current.provider),
    eq(webhookTable.isActive, current.isActive),
    ...conditions
  )
}
type AirtableCredentialScope = {
  userId: string
  workspaceId?: string | null
  storedCredential?: true
}
const AIRTABLE_PENDING_CLEANUP_KEY = 'airtablePendingCleanup'
const AIRTABLE_LIFECYCLE_KEY = 'airtableLifecycle'
type AirtablePreviousWebhook = Pick<
  typeof webhookTable.$inferSelect,
  'blockId' | 'provider' | 'providerConfig' | 'isActive'
>
type AirtableStableWebhookLifecycle =
  | {
      phase: 'provisioning'
      previous: AirtablePreviousWebhook | null
      emptyObservations: 0 | 1
      expiresAt: number
    }
  | { phase: 'deleting' }
type AirtableWebhookLifecycle =
  | AirtableStableWebhookLifecycle
  | {
      phase: 'cleanup'
      owner: string
      target: AirtableWebhookCleanup
      expiresAt: number
      resume: AirtableStableWebhookLifecycle | null
    }
export const setAirtableWebhookDeadline = (value: unknown) =>
  sql`jsonb_set(${JSON.stringify(toConfig(value))}::jsonb, '{airtableLifecycle,expiresAt}', to_jsonb(floor(extract(epoch from (clock_timestamp() + interval '60 seconds')) * 1000)::bigint), true)::json`
const airtableWebhookDeadlineExpired = () =>
  sql`(${webhookTable.providerConfig}->'airtableLifecycle'->>'expiresAt')::bigint <= floor(extract(epoch from clock_timestamp()) * 1000)::bigint`
const getAirtableAccessToken = (
  credentialId: string,
  requestId: string,
  scope: AirtableCredentialScope
) =>
  scope.storedCredential && scope.workspaceId
    ? getOAuthAccessTokenForStoredCredential({
        credentialId,
        workspaceId: scope.workspaceId,
        requestId,
      })
    : getOAuthAccessTokenForUserCredential({
        credentialId,
        userId: scope.userId,
        ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
        requestId,
      })

export function getAirtableDeclarativeProviderConfig(value: unknown) {
  const {
    externalId: _externalId,
    externalWebhookCursor: _externalWebhookCursor,
    [AIRTABLE_PENDING_CLEANUP_KEY]: _pendingCleanup,
    [AIRTABLE_LIFECYCLE_KEY]: _lifecycle,
    ...config
  } = toConfig(value)
  return config
}
export function getAirtableWebhookCleanup(value: unknown): AirtableWebhookCleanup | null {
  const { baseId, externalId, credentialId } = toConfig(value)
  if (
    typeof baseId !== 'string' ||
    !baseId ||
    typeof externalId !== 'string' ||
    !externalId ||
    typeof credentialId !== 'string' ||
    !credentialId
  )
    return null
  return { baseId, externalId, credentialId }
}
export function getPendingAirtableWebhookCleanup(value: unknown) {
  const cleanup = toConfig(value)[AIRTABLE_PENDING_CLEANUP_KEY]
  return Array.isArray(cleanup)
    ? cleanup
        .map(getAirtableWebhookCleanup)
        .filter((entry): entry is AirtableWebhookCleanup => entry !== null)
    : []
}
function getStableAirtableWebhookLifecycle(value: unknown): AirtableStableWebhookLifecycle | null {
  const lifecycle = toConfig(value)
  if (lifecycle.phase === 'deleting') return { phase: 'deleting' }
  if (
    lifecycle.phase !== 'provisioning' ||
    (lifecycle.emptyObservations !== 0 && lifecycle.emptyObservations !== 1) ||
    typeof lifecycle.expiresAt !== 'number' ||
    !Number.isFinite(lifecycle.expiresAt) ||
    (lifecycle.previous !== null && toConfig(lifecycle.previous) !== lifecycle.previous)
  )
    return null
  return lifecycle as AirtableStableWebhookLifecycle
}
export function getAirtableWebhookLifecycle(value: unknown): AirtableWebhookLifecycle | null {
  const lifecycle = toConfig(value)[AIRTABLE_LIFECYCLE_KEY]
  const stable = getStableAirtableWebhookLifecycle(lifecycle)
  if (stable) return stable
  const cleanup = toConfig(lifecycle)
  const target = getAirtableWebhookCleanup(cleanup.target)
  const resume = cleanup.resume === null ? null : getStableAirtableWebhookLifecycle(cleanup.resume)
  return cleanup.phase === 'cleanup' &&
    typeof cleanup.owner === 'string' &&
    cleanup.owner &&
    typeof cleanup.expiresAt === 'number' &&
    Number.isFinite(cleanup.expiresAt) &&
    target &&
    (cleanup.resume === null || resume)
    ? { phase: 'cleanup', owner: cleanup.owner, target, expiresAt: cleanup.expiresAt, resume }
    : null
}
export function setAirtableWebhookLifecycle(
  value: unknown,
  lifecycle: AirtableWebhookLifecycle | null
) {
  const { [AIRTABLE_LIFECYCLE_KEY]: _lifecycle, ...config } = toConfig(value)
  return lifecycle ? { ...config, [AIRTABLE_LIFECYCLE_KEY]: lifecycle } : config
}
const cleanupKey = ({ baseId, externalId }: AirtableWebhookCleanup) => `${baseId}\0${externalId}`
const sameAirtableCleanup = (left: AirtableWebhookCleanup, right: AirtableWebhookCleanup) =>
  cleanupKey(left) === cleanupKey(right)
export function setPendingAirtableWebhookCleanup(
  value: unknown,
  cleanup: AirtableWebhookCleanup[]
) {
  const { [AIRTABLE_PENDING_CLEANUP_KEY]: _pendingCleanup, ...config } = toConfig(value)
  const uniqueCleanup = [...new Map(cleanup.map((entry) => [cleanupKey(entry), entry])).values()]
  return uniqueCleanup.length
    ? { ...config, [AIRTABLE_PENDING_CLEANUP_KEY]: uniqueCleanup }
    : config
}
export function toPublicAirtableWebhook<T extends { provider: unknown; providerConfig: unknown }>(
  value: T
): T {
  return value.provider === 'airtable'
    ? ({
        ...value,
        providerConfig: getAirtableDeclarativeProviderConfig(value.providerConfig),
      } as T)
    : value
}
function getAirtableWebhookSpecification(value: unknown) {
  const { tableId, includeCellValuesInFieldIds } = toConfig(value)
  if (typeof tableId !== 'string' || !tableId) {
    throw new Error('Base and table IDs are required to create an Airtable webhook')
  }
  return {
    options: {
      filters: { dataTypes: ['tableData'], recordChangeScope: tableId },
      ...(includeCellValuesInFieldIds === 'all'
        ? { includes: { includeCellValuesInFieldIds: 'all' } }
        : {}),
    },
  }
}
export function validateAirtableWebhookConfig(value: unknown) {
  const { baseId, credentialId } = toConfig(value)
  if (typeof baseId !== 'string' || !baseId) {
    throw new Error('Base and table IDs are required to create an Airtable webhook')
  }
  getAirtableWebhookSpecification(value)
  if (typeof credentialId !== 'string' || !credentialId) {
    throw new Error('Airtable account connection required.')
  }
  return { baseId, credentialId }
}
export async function createAirtableWebhookSubscription(
  webhookData: { id: string; path: string; providerConfig: unknown },
  requestId: string,
  accessToken: string
) {
  const { id, path } = webhookData
  const config = toConfig(webhookData.providerConfig)
  const { baseId, credentialId } = validateAirtableWebhookConfig(config)
  const specification = getAirtableWebhookSpecification(config)
  const response = await fetch(`https://api.airtable.com/v0/bases/${baseId}/webhooks`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      notificationUrl: `${getBaseUrl()}/api/webhooks/trigger/${path}`,
      specification,
    }),
  })
  const body = (await response.json()) as { id?: unknown; error?: { message?: string } | string }
  if (!response.ok || body.error) {
    const detail =
      (typeof body.error === 'object' && body.error?.message) ||
      body.error ||
      'Unknown Airtable API error'
    airtableLogger.error(
      `[${requestId}] Failed to create webhook in Airtable for webhook ${id}. Status: ${response.status}`,
      { response: body }
    )
    const RejectionError =
      response.status >= 400 && response.status < 500 && response.status !== 408
        ? AirtableWebhookRejectedError
        : Error
    throw new RejectionError(String(detail))
  }
  const externalId = typeof body.id === 'string' ? body.id.trim() : ''
  if (!externalId) throw new Error('Airtable webhook creation returned no webhook ID')
  return { baseId, externalId, credentialId } satisfies AirtableWebhookCleanup
}
async function deleteAirtableWebhookSubscription(
  cleanup: AirtableWebhookCleanup,
  requestId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/bases/${cleanup.baseId}/webhooks/${cleanup.externalId}`,
      {
        method: 'DELETE',
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    if (response.ok || response.status === 404) return true
    airtableLogger.error(`[${requestId}] Failed to clean up Airtable webhook`, {
      externalId: cleanup.externalId,
      status: response.status,
    })
    return false
  } catch (error) {
    airtableLogger.error(`[${requestId}] Exception cleaning up Airtable webhook`, {
      externalId: cleanup.externalId,
      error,
    })
    return false
  }
}
export async function processAirtableWebhookCleanup(
  current: typeof webhookTable.$inferSelect,
  requestId: string,
  scope: AirtableCredentialScope
) {
  const lifecycle = getAirtableWebhookLifecycle(current.providerConfig)
  const resume = lifecycle?.phase === 'cleanup' ? lifecycle.resume : lifecycle
  const target =
    lifecycle?.phase === 'cleanup'
      ? lifecycle.target
      : getPendingAirtableWebhookCleanup(current.providerConfig)[0]
  if (!target) return { cleaned: false, webhook: current }
  const accessToken = await getAirtableAccessToken(target.credentialId, requestId, scope)
  if (!accessToken) return { cleaned: false, webhook: current }
  const owner = crypto.randomUUID()
  const conditions = lifecycle?.phase === 'cleanup' ? [airtableWebhookDeadlineExpired()] : []
  const claim = getWebhookRevision(current, eq(webhookTable.provider, 'airtable'), ...conditions)
  const lease: AirtableWebhookLifecycle = {
    phase: 'cleanup',
    owner,
    target,
    expiresAt: 0,
    resume,
  }
  const claimedConfig = setAirtableWebhookLifecycle(
    setPendingAirtableWebhookCleanup(current.providerConfig, [
      ...getPendingAirtableWebhookCleanup(current.providerConfig),
      target,
    ]),
    lease
  )
  const [claimed] = await db
    .update(webhookTable)
    .set({
      providerConfig: setAirtableWebhookDeadline(claimedConfig),
      updatedAt: claim.updatedAt,
    })
    .where(claim.where)
    .returning()
  if (!claimed) return { cleaned: false, webhook: current }
  const cleaned = await deleteAirtableWebhookSubscription(target, requestId, accessToken)
  const pending = getPendingAirtableWebhookCleanup(claimed.providerConfig).filter(
    (entry) => !cleaned || !sameAirtableCleanup(entry, target)
  )
  const nextConfig = setAirtableWebhookLifecycle(
    setPendingAirtableWebhookCleanup(claimed.providerConfig, pending),
    resume
  )
  const settlement = getWebhookRevision(
    claimed,
    eq(webhookTable.provider, 'airtable'),
    sql`${webhookTable.providerConfig}->'airtableLifecycle'->>'owner' = ${owner}`
  )
  if (cleaned && resume?.phase === 'deleting' && !pending.length) {
    const [deleted] = await db.delete(webhookTable).where(settlement.where).returning()
    return { cleaned: Boolean(deleted), webhook: deleted ? null : claimed }
  }
  const [settled] = await db
    .update(webhookTable)
    .set({
      providerConfig: nextConfig,
      updatedAt: settlement.updatedAt,
    })
    .where(settlement.where)
    .returning()
  return { cleaned: cleaned && Boolean(settled), webhook: settled ?? claimed }
}
async function listMatchingAirtableWebhookCleanup(
  providerConfig: unknown,
  path: string,
  requestId: string,
  userId: string,
  workspaceId: string | null,
  excluded: AirtableWebhookCleanup[]
): Promise<AirtableWebhookCleanup[] | null> {
  const config = toConfig(providerConfig)
  const { baseId, credentialId } = config
  if (typeof baseId !== 'string' || !baseId || typeof credentialId !== 'string' || !credentialId)
    return null
  try {
    const accessToken = await getAirtableAccessToken(credentialId, requestId, {
      storedCredential: true,
      userId,
      workspaceId,
    })
    if (!accessToken) return null
    const response = await fetch(`https://api.airtable.com/v0/bases/${baseId}/webhooks`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      webhooks?: Array<{ id?: unknown; notificationUrl?: unknown; specification?: unknown }>
    }
    if (!Array.isArray(body.webhooks)) return null
    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`
    const specification = stableStringifyJsonValue(getAirtableWebhookSpecification(config))
    const matches: AirtableWebhookCleanup[] = []
    for (const rawEntry of body.webhooks) {
      const entry = toConfig(rawEntry)
      if (entry.notificationUrl === null) continue
      if (typeof entry.notificationUrl !== 'string') return null
      if (entry.notificationUrl !== notificationUrl) continue
      if (
        typeof entry.id !== 'string' ||
        !entry.id.trim() ||
        toConfig(entry.specification) !== entry.specification
      )
        return null
      if (stableStringifyJsonValue(entry.specification) !== specification) continue
      matches.push({ baseId, credentialId, externalId: entry.id })
    }
    return matches.filter((entry) => !excluded.some((known) => sameAirtableCleanup(entry, known)))
  } catch {
    return null
  }
}
export async function sweepAirtableWebhookCleanup(requestId: string) {
  const rows = await db
    .select({
      webhook: webhookTable,
      userId: workflowTable.userId,
      workspaceId: workflowTable.workspaceId,
    })
    .from(webhookTable)
    .innerJoin(workflowTable, eq(webhookTable.workflowId, workflowTable.id))
    .where(eq(webhookTable.provider, 'airtable'))
  for (const row of rows) {
    try {
      let current = row.webhook
      const updateCurrent = async (values: Partial<typeof current>, ...conditions: SQL[]) => {
        const revision = getWebhookRevision(
          current,
          eq(webhookTable.provider, 'airtable'),
          ...conditions
        )
        const [saved] = await db
          .update(webhookTable)
          .set({ ...values, updatedAt: revision.updatedAt })
          .where(revision.where)
          .returning()
        if (saved) current = saved
        return saved
      }
      const updateConfig = (providerConfig: unknown, ...conditions: SQL[]) =>
        updateCurrent({ providerConfig }, ...conditions)
      const deleteCurrent = async () => {
        const revision = getWebhookRevision(current, eq(webhookTable.provider, 'airtable'))
        return (await db.delete(webhookTable).where(revision.where).returning())[0]
      }
      let lifecycle = getAirtableWebhookLifecycle(current.providerConfig)
      let pending = getPendingAirtableWebhookCleanup(current.providerConfig)
      const scope = {
        storedCredential: true as const,
        userId: row.userId,
        workspaceId: row.workspaceId,
      }
      if (lifecycle?.phase === 'cleanup') {
        await processAirtableWebhookCleanup(current, requestId, scope)
        continue
      }
      const active = getAirtableWebhookCleanup(current.providerConfig)
      const remotePending = pending.filter(
        (cleanup) => !active || !sameAirtableCleanup(active, cleanup)
      )
      if (remotePending.length !== pending.length) {
        const saved = await updateConfig(
          setPendingAirtableWebhookCleanup(current.providerConfig, remotePending)
        )
        if (!saved) continue
        pending = remotePending
      }
      if (pending.length) {
        await processAirtableWebhookCleanup(current, requestId, scope)
        continue
      }
      lifecycle = getAirtableWebhookLifecycle(current.providerConfig)
      if (lifecycle?.phase === 'provisioning') {
        const claimed = await updateConfig(
          setAirtableWebhookDeadline(current.providerConfig),
          airtableWebhookDeadlineExpired()
        )
        if (!claimed) continue
        lifecycle = getAirtableWebhookLifecycle(current.providerConfig)
        if (lifecycle?.phase !== 'provisioning') continue
        const previousActive = getAirtableWebhookCleanup(lifecycle.previous?.providerConfig)
        const matches = await listMatchingAirtableWebhookCleanup(
          current.providerConfig,
          current.path,
          requestId,
          row.userId,
          row.workspaceId,
          previousActive ? [previousActive] : []
        )
        if (matches === null) continue
        if (matches.length) {
          const saved = await updateConfig(
            setAirtableWebhookLifecycle(
              setPendingAirtableWebhookCleanup(current.providerConfig, matches),
              { ...lifecycle, emptyObservations: 0 }
            )
          )
          if (saved) await processAirtableWebhookCleanup(saved, requestId, scope)
        } else if (lifecycle.emptyObservations === 0) {
          await updateConfig(
            setAirtableWebhookLifecycle(current.providerConfig, {
              ...lifecycle,
              emptyObservations: 1,
            })
          )
        } else if (lifecycle.previous) {
          if (!(await updateCurrent(lifecycle.previous))) continue
        } else {
          if (!(await deleteCurrent())) continue
        }
        continue
      }
      if (
        (lifecycle?.phase === 'deleting' || (!current.isActive && !active)) &&
        !(await deleteCurrent())
      )
        continue
    } catch (error) {
      airtableLogger.error(`[${requestId}] Failed to reconcile Airtable webhook`, { error })
    }
  }
}
async function deleteTeamsRemote(externalId: string, accessToken: string) {
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${externalId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return response.ok || response.status === 404
  } catch {
    return false
  }
}
type ExternalSubscriptionWebhookWriter = (
  client: Pick<typeof db, 'insert' | 'update'>
) => Promise<(typeof webhookTable.$inferSelect)[]>
export async function createTeamsSubscription(
  webhookData: Pick<
    typeof webhookTable.$inferSelect,
    'id' | 'path' | 'provider' | 'providerConfig'
  >,
  workflow: { workspaceId: string },
  requestId: string,
  persistWebhook: ExternalSubscriptionWebhookWriter
) {
  let accessToken: string | null = null
  let createdId: string | undefined
  try {
    const config = toConfig(webhookData.providerConfig)
    const { credentialId, chatId, externalSubscriptionId } = config
    if (typeof credentialId !== 'string' || !credentialId || typeof chatId !== 'string' || !chatId)
      return null
    accessToken = await getOAuthAccessTokenForStoredCredential({
      credentialId,
      workspaceId: workflow.workspaceId,
      requestId,
    })
    if (!accessToken) return null
    return await db.transaction(async (tx) => {
      await lockExternalSubscriptionCredentials(
        tx,
        getExternalSubscriptionCredentialIds(webhookData)
      )
      const [stored] = await persistWebhook(tx)
      if (!stored) throw new WebhookRevisionConflictError()
      const storedConfig = toConfig(stored.providerConfig)
      if (typeof externalSubscriptionId === 'string' && externalSubscriptionId) {
        const check = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
          {
            signal: AbortSignal.timeout(30_000),
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        )
        if (!check.ok && check.status !== 404) throw new Error('Teams subscription check failed')
        if (check.ok) return stored
      }
      const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${stored.path}`
      const expirationDateTime = new Date(Date.now() + 4230 * 60 * 1000).toISOString()
      const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          changeType: 'created,updated',
          notificationUrl,
          lifecycleNotificationUrl: notificationUrl,
          resource: `/chats/${chatId}/messages`,
          includeResourceData: false,
          expirationDateTime,
          clientState: stored.id,
        }),
      })
      const payload = await response.json()
      if (!response.ok || typeof payload.id !== 'string' || !payload.id) {
        throw new Error('Failed to create Teams subscription')
      }
      createdId = payload.id
      const [saved] = await tx
        .update(webhookTable)
        .set({
          providerConfig: {
            ...storedConfig,
            externalSubscriptionId: createdId,
            subscriptionExpiration: payload.expirationDateTime,
          },
          updatedAt: getWebhookRevision(stored).updatedAt,
        })
        .where(eq(webhookTable.id, stored.id))
        .returning()
      if (!saved) throw new WebhookRevisionConflictError()
      return saved
    })
  } catch (error) {
    if (createdId && accessToken && !(await deleteTeamsRemote(createdId, accessToken))) {
      teamsLogger.error(`[${requestId}] Failed to compensate Teams subscription ${createdId}`)
    }
    if (error instanceof WebhookRevisionConflictError) throw error
    teamsLogger.error(`[${requestId}] Failed to configure Teams subscription`, error)
    return null
  }
}
export async function deleteTeamsWebhook(webhook: any, workflow: any, requestId: string) {
  const config = (webhook.providerConfig as Record<string, any>) || {}
  const isChatSubscription = config.triggerId === 'microsoftteams_chat_subscription'
  const externalId = config.externalSubscriptionId
  let accessToken: string | null = null
  if (isChatSubscription && externalId) {
    if (!config.credentialId) throw new Error('Missing Teams credential')
    accessToken = await getOAuthAccessTokenForStoredCredential({
      credentialId: config.credentialId,
      workspaceId: workflow.workspaceId,
      requestId,
    })
    if (!accessToken) throw new Error('Teams subscription credential is unavailable')
  }
  return db.transaction(async (tx) => {
    const revision = getWebhookSnapshotRevision(webhook)
    const [deleted] = await tx.delete(webhookTable).where(revision.where).returning()
    if (!deleted) return null
    if (
      isChatSubscription &&
      externalId &&
      (!accessToken || !(await deleteTeamsRemote(externalId, accessToken)))
    ) {
      throw new Error('Teams subscription deletion failed')
    }
    return deleted
  })
}

async function deleteWebflowRemote(externalId: string, accessToken: string) {
  try {
    const response = await fetch(`https://api.webflow.com/v2/webhooks/${externalId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return response.ok || response.status === 404
  } catch {
    return false
  }
}

export async function createWebflowWebhookSubscription(
  webhookData: any,
  requestId: string,
  scope: { userId: string; workspaceId?: string },
  persistWebhook: ExternalSubscriptionWebhookWriter
) {
  let accessToken: string | null = null
  let createdId: string | undefined
  try {
    const { providerConfig } = webhookData
    const { siteId, triggerId, collectionId, formId, credentialId } = providerConfig || {}
    if (!siteId || !triggerId) throw new Error('Webflow site and trigger are required')
    if (!credentialId) throw new Error('Webflow account connection required')
    accessToken = await getOAuthAccessTokenForUserCredential({
      credentialId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      requestId,
    })
    if (!accessToken) throw new Error('Webflow account connection required')
    const triggerTypes: Record<string, string> = {
      webflow_collection_item_created: 'collection_item_created',
      webflow_collection_item_changed: 'collection_item_changed',
      webflow_collection_item_deleted: 'collection_item_deleted',
      webflow_form_submission: 'form_submission',
    }
    const triggerType = triggerTypes[triggerId]
    if (!triggerType) throw new Error(`Invalid Webflow trigger type: ${triggerId}`)
    return await db.transaction(async (tx) => {
      await lockExternalSubscriptionCredentials(
        tx,
        getExternalSubscriptionCredentialIds(webhookData)
      )
      const [stored] = await persistWebhook(tx)
      if (!stored) throw new WebhookRevisionConflictError()
      const storedConfig = toConfig(stored.providerConfig)
      const body: Record<string, unknown> = {
        triggerType,
        url: `${getBaseUrl()}/api/webhooks/trigger/${stored.path}`,
      }
      if (collectionId && triggerType.startsWith('collection_item_')) {
        body.filter = { resource_type: 'collection', resource_id: collectionId }
      }
      if (formId && triggerType === 'form_submission') {
        body.filter = { resource_type: 'form', resource_id: formId }
      }
      const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/webhooks`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      createdId = payload.id || payload._id
      if (!response.ok || payload.error || !createdId) {
        throw new Error(payload.message || payload.error || 'Webflow webhook creation failed')
      }
      const [saved] = await tx
        .update(webhookTable)
        .set({
          providerConfig: { ...storedConfig, externalId: createdId },
          updatedAt: getWebhookRevision(stored).updatedAt,
        })
        .where(eq(webhookTable.id, stored.id))
        .returning()
      if (!saved) throw new WebhookRevisionConflictError()
      return saved
    })
  } catch (error) {
    if (createdId && accessToken && !(await deleteWebflowRemote(createdId, accessToken))) {
      webflowLogger.error(`[${requestId}] Failed to compensate Webflow webhook ${createdId}`)
    }
    throw error
  }
}

export async function deleteWebflowWebhook(webhook: any, workflow: any, requestId: string) {
  const config = (webhook.providerConfig as Record<string, any>) || {}
  const externalId = config.externalId
  let accessToken: string | null = null
  if (externalId) {
    if (!config.credentialId) throw new Error('Missing Webflow credential')
    accessToken = await getOAuthAccessTokenForUserCredential({
      credentialId: config.credentialId,
      userId: workflow.userId,
      workspaceId: workflow.workspaceId ?? undefined,
      requestId,
    })
    if (!accessToken) throw new Error('Webflow subscription credential is unavailable')
  }
  return db.transaction(async (tx) => {
    const revision = getWebhookSnapshotRevision(webhook)
    const [deleted] = await tx.delete(webhookTable).where(revision.where).returning()
    if (!deleted) return null
    if (externalId && (!accessToken || !(await deleteWebflowRemote(externalId, accessToken)))) {
      throw new Error('Webflow subscription deletion failed')
    }
    return deleted
  })
}
export async function createTelegramWebhook(webhook: any, requestId: string) {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined
    if (!botToken) return null
    return await db.transaction(async (tx) => {
      const claim = getWebhookRevision(
        webhook,
        eq(webhookTable.provider, 'telegram'),
        eq(webhookTable.isActive, true)
      )
      const [claimed] = await tx
        .update(webhookTable)
        .set({ updatedAt: claim.updatedAt })
        .where(claim.where)
        .returning()
      if (!claimed) throw new WebhookRevisionConflictError()
      const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TelegramBot/1.0',
        },
        body: JSON.stringify({ url: `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}` }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.description || 'Telegram setup failed')
      return claimed
    })
  } catch (error) {
    if (error instanceof WebhookRevisionConflictError) throw error
    telegramLogger.error(`[${requestId}] Failed to configure Telegram webhook`, error)
    return null
  }
}
