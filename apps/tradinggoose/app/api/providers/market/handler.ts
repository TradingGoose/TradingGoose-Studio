import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { executeProviderRequest } from '@/providers/market'
import type { MarketProviderRequest } from '@/providers/market/providers'
import type { MarketDataType, NormalizationMode } from '@/providers/market/types'
import { MARKET_DATA_TYPES, NORMALIZATION_MODES } from '@/providers/market/types'

const logger = createLogger('ProvidersAPI:Market')

export interface MarketProviderRouteBody {
  provider?: string
  providerNamespace?: 'market'
  providerType?: 'market'
  kind?: MarketDataType
  listingId?: string
  interval?: string
  start?: string | number
  end?: string | number
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
    const MarketProviderRequestSchema = z.object({
      kind: z.enum(MARKET_DATA_TYPES).default('series'),
      listingId: z.string().min(1),
      interval: z.string().optional(),
      start: z.union([z.string(), z.number()]).optional(),
      end: z.union([z.string(), z.number()]).optional(),
      normalizationMode: z.enum(NORMALIZATION_MODES).optional(),
      stream: z.string().optional(),
      providerParams: z.record(z.any()).optional(),
    })

    const parsed = MarketProviderRequestSchema.safeParse({
      kind: body.kind ?? 'series',
      listingId: body.listingId,
      interval: body.interval,
      start: body.start,
      end: body.end,
      normalizationMode: body.normalizationMode,
      stream: body.stream,
      providerParams: body.providerParams,
    })

    if (!parsed.success) {
      logger.warn(`[${requestId}] Invalid market provider request`, {
        errors: parsed.error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.errors },
        { status: 400 }
      )
    }

    const requestPayload = parsed.data as MarketProviderRequest

    logger.info(`[${requestId}] Executing market provider request`, {
      provider: providerId,
      kind: requestPayload.kind,
      listingId: requestPayload.listingId,
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
    logger.error(`[${requestId}] Market provider request failed`, {
      provider: providerId,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Market provider error' },
      { status: 500 }
    )
  }
}
