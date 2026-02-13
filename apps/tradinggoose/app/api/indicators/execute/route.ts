import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { buildInputsMapFromMeta, normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import { resolveListingKey } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  authenticateIndicatorRequest,
  getWorkspaceWritePermissionError,
  isExecutionTimeoutError,
  parseIndicatorRequestBody,
  resolveIndicatorRuntimeConfig,
} from '../utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const logger = createLogger('IndicatorExecuteAPI')
const EXECUTION_TIMEOUT_MS = 15000
const MAX_BARS = 2000

const MarketBarSchema = z.object({
  timeStamp: z.string(),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number(),
  volume: z.number().optional(),
  turnover: z.number().optional(),
})

const MarketSeriesSchema = z.object({
  listing: z.any().nullable().optional(),
  bars: z.array(MarketBarSchema).min(1, 'marketSeries.bars is required'),
})

const ExecuteSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicatorIds: z.array(z.string().min(1)).min(1, 'indicatorIds is required'),
  marketSeries: MarketSeriesSchema,
  interval: z.string().optional(),
  intervalMs: z.number().optional(),
  inputsMapById: z.record(z.record(z.any())).optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'execute',
    })
    if ('response' in auth) return auth.response

    const parsedBody = await parseIndicatorRequestBody({ request, schema: ExecuteSchema })
    if ('response' in parsedBody) return parsedBody.response

    const { workspaceId, indicatorIds, interval, intervalMs } = parsedBody.data

    const permissionError = await getWorkspaceWritePermissionError(auth.userId, workspaceId)
    if (permissionError) return permissionError

    const userSubscription = await getHighestPrioritySubscription(auth.userId)
    const { useE2B, e2bTemplate, e2bKeepWarmMs } = resolveIndicatorRuntimeConfig(
      userSubscription?.plan
    )

    const requestedMarketSeries = parsedBody.data.marketSeries
    const requestedBars = requestedMarketSeries.bars
    const barsWereTruncated = requestedBars.length > MAX_BARS
    const marketSeries = barsWereTruncated
      ? { ...requestedMarketSeries, bars: requestedBars.slice(-MAX_BARS) }
      : requestedMarketSeries
    const barsMs = mapMarketSeriesToBarsMs(marketSeries, intervalMs ?? null)
    const listingKey = resolveListingKey(marketSeries.listing ?? undefined)

    const customIndicatorIds = indicatorIds.filter((id) => !DEFAULT_INDICATOR_RUNTIME_MAP.has(id))
    const storedIndicators =
      customIndicatorIds.length > 0
        ? await db
            .select()
            .from(pineIndicators)
            .where(
              and(
                eq(pineIndicators.workspaceId, workspaceId),
                inArray(pineIndicators.id, customIndicatorIds)
              )
            )
        : []

    const indicatorMap = new Map(storedIndicators.map((indicator) => [indicator.id, indicator]))

    const results = await Promise.all(
      indicatorIds.map(async (indicatorId) => {
        const customIndicator = indicatorMap.get(indicatorId)
        const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(indicatorId)

        if (!customIndicator && !defaultIndicator) {
          return {
            indicatorId,
            output: null,
            warnings: [{ code: 'missing_indicator', message: `${indicatorId} is missing.` }],
            unsupported: { plots: [], styles: [] },
            counts: { plots: 0, markers: 0, signals: 0 },
            executionError: { message: 'Indicator not found', code: 'missing_indicator' },
          }
        }

        const pineCode = customIndicator?.pineCode ?? defaultIndicator?.pineCode ?? ''
        const inputMeta = customIndicator
          ? normalizeInputMetaMap(customIndicator.inputMeta)
          : defaultIndicator?.inputMeta
        const inputsOverride = parsedBody.data.inputsMapById?.[indicatorId]
        const baseInputsMap = buildInputsMapFromMeta(inputMeta)
        const inputsMap = inputsOverride ? { ...baseInputsMap, ...inputsOverride } : baseInputsMap

        const warnings: Array<{ code: string; message: string }> = []
        if (barsWereTruncated) {
          warnings.push({
            code: 'bars_truncated',
            message: `Bars were capped to the latest ${MAX_BARS} entries for execution.`,
          })
        }

        try {
          const compiled = await executeCompiledIndicator({
            pineCode,
            barsMs,
            inputsMap,
            listingKey,
            interval,
            intervalMs,
            useE2B,
            e2bTemplate,
            e2bKeepWarmMs,
            executionTimeoutMs: EXECUTION_TIMEOUT_MS,
          })

          if (compiled.unsupportedFeatures && compiled.unsupportedFeatures.length > 0) {
            return {
              indicatorId,
              output: null,
              warnings,
              unsupported: { plots: [], styles: [] },
              counts: { plots: 0, markers: 0, signals: 0 },
              executionError: {
                message: `${compiled.unsupportedFeatures[0]} is not supported`,
                code: 'unsupported_feature',
                unsupported: { features: compiled.unsupportedFeatures },
              },
            }
          }

          if (!compiled.output) {
            return {
              indicatorId,
              output: null,
              warnings,
              unsupported: compiled.unsupported ?? { plots: [], styles: [] },
              counts: { plots: 0, markers: 0, signals: 0 },
              executionError: {
                message: compiled.executionError?.message ?? 'Failed to execute indicator',
                code: 'runtime_error',
              },
            }
          }

          const output = compiled.output
          const counts = {
            plots: output.series.length,
            markers: output.markers.length,
            signals: output.signals.length,
          }

          return {
            indicatorId,
            output,
            warnings: [...warnings, ...compiled.warnings],
            unsupported: output.unsupported,
            counts,
          }
        } catch (error) {
          const timedOut = isExecutionTimeoutError(error)
          return {
            indicatorId,
            output: null,
            warnings,
            unsupported: { plots: [], styles: [] },
            counts: { plots: 0, markers: 0, signals: 0 },
            executionError: {
              message: timedOut ? 'Execution timed out' : 'Failed to execute indicator',
              code: timedOut ? 'timeout' : 'runtime_error',
            },
          }
        }
      })
    )

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    logger.error(`[${requestId}] Indicator execute failed`, { error })
    return NextResponse.json(
      { success: false, error: 'Failed to execute indicators' },
      { status: 500 }
    )
  }
}
