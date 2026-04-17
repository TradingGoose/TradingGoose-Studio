import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { executeProviderRequest } from '@/providers/market'
import type { MarketSeries } from '@/providers/market/types'

const logger = createLogger('WatchlistQuotesAPI')

const QuoteRequestSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  provider: z.string().trim().min(1, 'provider is required'),
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1, 'itemId is required'),
        listing: z.any(),
      })
    )
    .min(1, 'items is required')
    .max(200, 'items supports up to 200 entries'),
  auth: z
    .object({
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
    })
    .optional(),
  providerParams: z.record(z.any()).optional(),
})

type QuoteSnapshot = {
  lastPrice: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  error?: string
}

const requireSessionUser = async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return null
  }
  return session.user.id
}

const requireWorkspaceReadPermission = async (userId: string, workspaceId: string) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return Boolean(permission)
}

const normalizeSeries = (value: unknown): MarketSeries | null => {
  if (!value || typeof value !== 'object') return null
  const series = value as MarketSeries
  if (!Array.isArray(series.bars)) return null
  return series
}

const buildDailyRequest = async ({
  provider,
  listing,
  auth,
  providerParams,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
}) => {
  const response = await executeProviderRequest(provider, {
    kind: 'series',
    listing,
    interval: '1d',
    windows: [{ mode: 'bars', barCount: 2 }],
    auth,
    providerParams: {
      ...(providerParams ?? {}),
      marketSession: 'regular',
    },
  })

  return normalizeSeries(response)
}

const buildRegularLastRequest = async ({
  provider,
  listing,
  auth,
  providerParams,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
}) => {
  try {
    const response = await executeProviderRequest(provider, {
      kind: 'series',
      listing,
      interval: '1m',
      windows: [{ mode: 'bars', barCount: 1 }],
      auth,
      providerParams: {
        ...(providerParams ?? {}),
        allowEmpty: true,
        marketSession: 'regular',
      },
    })

    return normalizeSeries(response)
  } catch {
    return null
  }
}

const buildQuoteSnapshot = async ({
  provider,
  listing,
  auth,
  providerParams,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
}): Promise<QuoteSnapshot> => {
  try {
    const daily = await buildDailyRequest({ provider, listing, auth, providerParams })
    const dailyBars = daily?.bars ?? []
    const latestDaily = dailyBars[dailyBars.length - 1]
    const previousDaily = dailyBars[dailyBars.length - 2]
    const latestDailyClose = typeof latestDaily?.close === 'number' ? latestDaily.close : null
    const previousClose =
      typeof previousDaily?.close === 'number'
        ? previousDaily.close
        : typeof latestDaily?.close === 'number'
          ? latestDaily.close
          : null
    const regular = await buildRegularLastRequest({ provider, listing, auth, providerParams })
    const regularBar = regular?.bars?.[regular.bars.length - 1]
    const regularLastPrice = typeof regularBar?.close === 'number' ? regularBar.close : null
    const lastPrice = regularLastPrice ?? latestDailyClose
    const change =
      typeof lastPrice === 'number' && typeof previousClose === 'number'
        ? lastPrice - previousClose
        : null
    const changePercent =
      typeof change === 'number' && typeof previousClose === 'number' && previousClose !== 0
        ? (change / previousClose) * 100
        : null

    return {
      lastPrice,
      change,
      changePercent,
      previousClose,
    }
  } catch (error) {
    return {
      lastPrice: null,
      change: null,
      changePercent: null,
      previousClose: null,
      error: error instanceof Error ? error.message : 'Failed to fetch snapshot',
    }
  }
}

const ENV_VAR_PATTERN = /\{\{([^}]+)\}\}/g

function hasEnvVarRefs(value: unknown): boolean {
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

function resolveEnvVarRefs(
  value: unknown,
  envVars: Record<string, string>,
  missing: Set<string>
): unknown {
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

const BATCH_SIZE = 10

export async function POST(request: NextRequest) {
  try {
    const userId = await requireSessionUser()
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

    const normalizedItems = parsed.items
      .map((candidate) => ({
        itemId: candidate.itemId.trim(),
        listing: toListingValueObject(candidate.listing),
      }))
      .filter(
        (value): value is { itemId: string; listing: ListingIdentity } =>
          value.itemId.length > 0 && Boolean(value.listing)
      )

    const quotes: Record<string, QuoteSnapshot> = {}

    for (let index = 0; index < normalizedItems.length; index += BATCH_SIZE) {
      const batch = normalizedItems.slice(index, index + BATCH_SIZE)
      const snapshots = await Promise.all(
        batch.map((entry) =>
          buildQuoteSnapshot({
            provider: parsed.provider,
            listing: entry.listing,
            auth,
            providerParams,
          })
        )
      )

      snapshots.forEach((snapshot, batchIndex) => {
        const itemId = batch[batchIndex]?.itemId
        if (!itemId) return
        quotes[itemId] = snapshot
      })
    }

    return NextResponse.json({ quotes }, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to fetch watchlist quote snapshots', { error })
    return NextResponse.json({ error: 'Failed to fetch quote snapshots' }, { status: 500 })
  }
}
