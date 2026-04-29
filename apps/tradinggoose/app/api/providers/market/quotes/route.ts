import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import {
  getListingIdentityKey,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import {
  createEmptyMarketQuoteSnapshot,
  MARKET_QUOTE_SNAPSHOT_PROVIDER_BATCH_SIZE,
  MARKET_QUOTE_SNAPSHOT_REQUEST_CAP,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

const logger = createLogger('MarketQuoteSnapshotsAPI')

const QuoteRequestSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  provider: z.string().trim().min(1, 'provider is required'),
  items: z
    .array(
      z.object({
        key: z.string(),
        listing: z.any(),
      })
    )
    .min(1, 'items is required'),
  auth: z
    .object({
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
    })
    .optional(),
  providerParams: z.record(z.any()).optional(),
})

const ENV_VAR_PATTERN = /\{\{([^}]+)\}\}/g

const hasEnvVarRefs = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.includes('{{') && value.includes('}}')
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasEnvVarRefs(item))
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasEnvVarRefs(item))
  }
  return false
}

const resolveEnvVarRefs = (
  value: unknown,
  envVars: Record<string, string>,
  missing: Set<string>
): unknown => {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_match, key) => {
      const trimmedKey = String(key).trim()
      if (!trimmedKey) return _match
      const envValue = envVars[trimmedKey]
      if (envValue === undefined) {
        missing.add(trimmedKey)
        return ''
      }
      return envValue
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvVarRefs(item, envVars, missing))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = resolveEnvVarRefs(val, envVars, missing)
      return acc
    }, {})
  }

  return value
}

const requireWorkspaceReadPermission = async (userId: string, workspaceId: string) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return Boolean(permission)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = QuoteRequestSchema.parse(await request.json())
    const hasPermission = await requireWorkspaceReadPermission(userId, parsed.workspaceId)
    if (!hasPermission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    let auth = parsed.auth
    let providerParams = parsed.providerParams
    if (hasEnvVarRefs(parsed.auth) || hasEnvVarRefs(parsed.providerParams)) {
      const envVars = await getEffectiveDecryptedEnv(userId, parsed.workspaceId)
      const missingVars = new Set<string>()
      auth = parsed.auth
        ? (resolveEnvVarRefs(parsed.auth, envVars, missingVars) as typeof parsed.auth)
        : parsed.auth
      providerParams = parsed.providerParams
        ? (resolveEnvVarRefs(
            parsed.providerParams,
            envVars,
            missingVars
          ) as typeof parsed.providerParams)
        : parsed.providerParams

      if (missingVars.size > 0) {
        const missingList = Array.from(missingVars)
        return NextResponse.json(
          {
            error: `Missing required environment variable${missingList.length > 1 ? 's' : ''}: ${missingList.join(', ')}`,
            details: { missing: missingList },
          },
          { status: 400 }
        )
      }
    }

    const seenResponseKeys = new Set<string>()
    const responseEntries: Array<{
      key: string
      identityKey?: string
      invalidSnapshot?: MarketQuoteSnapshot
    }> = []
    const providerEntries = new Map<string, ListingIdentity>()

    for (const candidate of parsed.items) {
      const key = candidate.key.trim()
      if (!key || seenResponseKeys.has(key)) continue

      if (seenResponseKeys.size >= MARKET_QUOTE_SNAPSHOT_REQUEST_CAP) {
        return NextResponse.json(
          {
            error: `items supports up to ${MARKET_QUOTE_SNAPSHOT_REQUEST_CAP} unique entries`,
          },
          { status: 400 }
        )
      }

      seenResponseKeys.add(key)
      const listing = toListingValueObject(candidate.listing)
      if (!listing) {
        responseEntries.push({
          key,
          invalidSnapshot: createEmptyMarketQuoteSnapshot('Invalid listing payload'),
        })
        continue
      }

      const identityKey = getListingIdentityKey(listing)
      responseEntries.push({ key, identityKey })
      if (!providerEntries.has(identityKey)) {
        providerEntries.set(identityKey, listing)
      }
    }

    if (responseEntries.length === 0) {
      return NextResponse.json({ error: 'items is required' }, { status: 400 })
    }

    const providerSnapshots = new Map<string, MarketQuoteSnapshot>()
    const providerRequests = Array.from(providerEntries.entries())

    for (
      let index = 0;
      index < providerRequests.length;
      index += MARKET_QUOTE_SNAPSHOT_PROVIDER_BATCH_SIZE
    ) {
      const batch = providerRequests.slice(index, index + MARKET_QUOTE_SNAPSHOT_PROVIDER_BATCH_SIZE)
      const snapshots = await Promise.all(
        batch.map(([, listing]) =>
          buildMarketQuoteSnapshot({
            provider: parsed.provider,
            listing,
            auth,
            providerParams,
          })
        )
      )

      snapshots.forEach((snapshot, batchIndex) => {
        const identityKey = batch[batchIndex]?.[0]
        if (!identityKey) return
        providerSnapshots.set(identityKey, snapshot)
      })
    }

    const quotes: Record<string, MarketQuoteSnapshot> = {}
    for (const entry of responseEntries) {
      quotes[entry.key] =
        entry.invalidSnapshot ??
        providerSnapshots.get(entry.identityKey ?? '') ??
        createEmptyMarketQuoteSnapshot('Failed to fetch snapshot')
    }

    return NextResponse.json({ quotes }, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to fetch market quote snapshots', { error })
    return NextResponse.json({ error: 'Failed to fetch quote snapshots' }, { status: 500 })
  }
}
