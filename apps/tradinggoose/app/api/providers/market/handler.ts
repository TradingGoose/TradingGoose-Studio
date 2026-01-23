import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
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
  kind?: MarketDataType
  listing?: ListingIdentity
  interval?: string
  start?: string | number
  end?: string | number
  window?: MarketSeriesWindow
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
    const ListingSchema = z
      .object({
        equity_id: z.string(),
        base_id: z.string(),
        quote_id: z.string(),
        listing_type: z.enum(['equity', 'crypto', 'currency']),
      })
      .passthrough()
      .superRefine((value, ctx) => {
        if (value.listing_type === 'equity' && !value.equity_id?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'equity listing requires equity_id',
          })
        }
        if (value.listing_type !== 'equity') {
          if (!value.base_id?.trim() || !value.quote_id?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'listing requires base_id and quote_id',
            })
          }
        }
      })

    const MarketSeriesWindowSchema = z
      .object({
        mode: z.enum(['bars', 'range']),
        barCount: z.number().optional(),
        range: z
          .object({
            value: z.number(),
            unit: z.enum(['day', 'week', 'month', 'year']),
          })
          .optional(),
      })
      .optional()

    const MarketProviderRequestSchema = z.object({
      kind: z.enum(MARKET_DATA_TYPES).default('series'),
      listing: ListingSchema,
      interval: z.string().optional(),
      start: z.union([z.string(), z.number()]).optional(),
      end: z.union([z.string(), z.number()]).optional(),
      window: MarketSeriesWindowSchema,
      normalizationMode: z.enum(NORMALIZATION_MODES).optional(),
      stream: z.string().optional(),
      providerParams: z.record(z.any()).optional(),
    })

    const parsed = MarketProviderRequestSchema.safeParse({
      kind: body.kind ?? 'series',
      listing: body.listing,
      interval: body.interval,
      start: body.start,
      end: body.end,
      window: body.window,
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

    logger.info(`[${requestId}] Executing market provider request`, {
      provider: providerId,
      kind: requestPayload.kind,
      listing: resolveListingKey(requestPayload.listing),
      interval: requestPayload.kind === 'series' ? requestPayload.interval : undefined,
      normalizationMode: requestPayload.normalizationMode,
    })

    const response = await executeProviderRequest(providerId, requestPayload)

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
