import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { resolveListingKey, type ListingIdentity } from '@/lib/listing/identity'
import { executeProviderRequest } from '@/providers/market'
import { MarketProviderError, normalizeMarketProviderError } from '@/providers/market/errors'
import type { MarketProviderRequest } from '@/providers/market/providers'
import type { MarketDataType, MarketSeriesWindow, NormalizationMode } from '@/providers/market/types'
import { MARKET_DATA_TYPES, NORMALIZATION_MODES } from '@/providers/market/types'

const logger = createLogger('ProvidersAPI:Market')

export interface MarketProviderRouteBody {
  provider?: string
  providerNamespace?: 'market'
  providerType?: 'market'
  workspaceId?: string
  kind?: MarketDataType
  listing?: ListingIdentity
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  interval?: string
  windows?: MarketSeriesWindow[]
  normalizationMode?: NormalizationMode
  stream?: string
  providerParams?: Record<string, any>
}

interface HandleMarketProviderParams {
  body: MarketProviderRouteBody
  providerId: string
  requestId: string
  startTime: number
}

export async function handleMarketProviderRequest({
  body,
  providerId,
  requestId,
  startTime,
}: HandleMarketProviderParams) {
  try {
    const workspaceId =
      typeof body.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : undefined

    const ListingSchema = z
      .object({
        listing_id: z.string(),
        base_id: z.string(),
        quote_id: z.string(),
        listing_type: z.enum(['default', 'crypto', 'currency']),
      })
      .passthrough()
      .superRefine((value, ctx) => {
        if (value.listing_type === 'default' && !value.listing_id?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'default listing requires listing_id',
          })
        }
        if (value.listing_type !== 'default') {
          if (!value.base_id?.trim() || !value.quote_id?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'listing requires base_id and quote_id',
            })
          }
        }
      })

    const MarketSeriesWindowSchema = z.discriminatedUnion('mode', [
      z.object({
        mode: z.literal('bars'),
        barCount: z.number(),
      }),
      z.object({
        mode: z.literal('range'),
        range: z.object({
          value: z.number(),
          unit: z.enum(['day', 'week', 'month', 'year']),
        }),
      }),
      z.object({
        mode: z.literal('absolute'),
        start: z.union([z.string(), z.number()]),
        end: z.union([z.string(), z.number()]).optional(),
      }),
    ])

    const MarketProviderRequestSchema = z.object({
      kind: z.enum(MARKET_DATA_TYPES).default('series'),
      listing: ListingSchema,
      auth: z
        .object({
          apiKey: z.string().optional(),
          apiSecret: z.string().optional(),
        })
        .optional(),
      interval: z.string().optional(),
      windows: z.array(MarketSeriesWindowSchema).optional(),
      normalizationMode: z.enum(NORMALIZATION_MODES).optional(),
      stream: z.string().optional(),
      providerParams: z.record(z.any()).optional(),
    })

    const parsed = MarketProviderRequestSchema.safeParse({
      kind: body.kind ?? 'series',
      listing: body.listing,
      auth: body.auth,
      interval: body.interval,
      windows: body.windows,
      normalizationMode: body.normalizationMode,
      stream: body.stream,
      providerParams: body.providerParams,
    })

    if (!parsed.success) {
      logger.warn(`[${requestId}] Invalid market provider request`, {
        errors: parsed.error.errors,
      })
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid request body',
            provider: providerId,
            details: parsed.error.errors,
          },
        },
        { status: 400 }
      )
    }

    const requestPayload = parsed.data as MarketProviderRequest
    let normalizedRequest: MarketProviderRequest = requestPayload as MarketProviderRequest

    if (
      hasEnvVarRefs(normalizedRequest.auth) ||
      hasEnvVarRefs(normalizedRequest.providerParams)
    ) {
      const session = await getSession()
      if (!session?.user?.id) {
        throw new MarketProviderError({
          code: 'INVALID REQUEST',
          message: 'Authentication required to resolve environment variables',
          provider: providerId,
          status: 401,
        })
      }

      const envVars = await getEffectiveDecryptedEnv(session.user.id, workspaceId)
      const missingVars = new Set<string>()
      const resolvedAuth = normalizedRequest.auth
        ? (resolveEnvVarRefs(normalizedRequest.auth, envVars, missingVars) as MarketProviderRequest['auth'])
        : normalizedRequest.auth
      const resolvedProviderParams = normalizedRequest.providerParams
        ? (resolveEnvVarRefs(
          normalizedRequest.providerParams,
          envVars,
          missingVars
        ) as MarketProviderRequest['providerParams'])
        : normalizedRequest.providerParams

      if (missingVars.size > 0) {
        const missingList = Array.from(missingVars)
        throw new MarketProviderError({
          code: 'INVALID REQUEST',
          message: `Missing required environment variable${missingList.length > 1 ? 's' : ''}: ${missingList.join(', ')}`,
          provider: providerId,
          status: 400,
          details: { missing: missingList },
        })
      }

      normalizedRequest = {
        ...normalizedRequest,
        auth: resolvedAuth,
        providerParams: resolvedProviderParams,
      }
    }

    logger.info(`[${requestId}] Executing market provider request`, {
      provider: providerId,
      kind: normalizedRequest.kind,
      listing: resolveListingKey(normalizedRequest.listing),
      interval: normalizedRequest.kind === 'series' ? normalizedRequest.interval : undefined,
      normalizationMode: normalizedRequest.normalizationMode,
    })

    const response = await executeProviderRequest(providerId, normalizedRequest)

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Market provider request completed`, {
      provider: providerId,
      kind: requestPayload.kind,
      executionTime,
    })

    return NextResponse.json(response)
  } catch (error) {
    const normalized =
      error instanceof MarketProviderError
        ? error
        : normalizeMarketProviderError(error, providerId)

    logger.error(`[${requestId}] Market provider request failed`, {
      provider: providerId,
      code: normalized.code,
      error: normalized.message,
    })

    return NextResponse.json(
      {
        error: {
          code: normalized.code,
          message: normalized.message,
          provider: normalized.provider ?? providerId,
          details: normalized.details,
        },
      },
      { status: normalized.status ?? 502 }
    )
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
