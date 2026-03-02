import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getCodeExecutionConcurrencyLimitMessage,
  isCodeExecutionConcurrencyLimitError,
  withCodeExecutionConcurrencyLimit,
} from '@/lib/execution/concurrency-limit'
import {
  getLocalVmSaturationLimitMessage,
  isLocalVmSaturationLimitError,
} from '@/lib/execution/local-saturation-limit'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { buildInputsMapFromMeta, normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import { toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  authenticateIndicatorRequest,
  getWorkspaceWritePermissionError,
  isExecutionTimeoutError,
  parseIndicatorRequestBody,
} from '../utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const logger = createLogger('IndicatorExecuteAPI')
const EXECUTION_TIMEOUT_MS = 15000

type IndicatorExecuteWarning = {
  code: string
  message: string
}

type ExecuteResult = {
  indicatorId: string
  output: unknown | null
  warnings: IndicatorExecuteWarning[]
  unsupported: unknown
  counts: { plots: number; markers: number; triggers: number }
  executionError?: { message: string; code: string; unsupported?: unknown }
}

const MarketBarSchema = z.object({
  timeStamp: z.string(),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number(),
  volume: z.number().optional(),
  turnover: z.number().optional(),
})

const ListingIdentitySchema = z.object({
  listing_id: z.string(),
  base_id: z.string(),
  quote_id: z.string(),
  listing_type: z.enum(['default', 'crypto', 'currency']),
})

const MarketSeriesSchema = z.object({
  listing: ListingIdentitySchema.nullable().optional(),
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

    const marketSeries = parsedBody.data.marketSeries
    const barsMs = mapMarketSeriesToBarsMs(marketSeries, intervalMs ?? null)
    const executionListing = toListingValueObject(marketSeries.listing ?? null)

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

    const results = await withCodeExecutionConcurrencyLimit({
      userId: auth.userId,
      task: async () => {
        const results: ExecuteResult[] = []
        for (const indicatorId of indicatorIds) {
          const customIndicator = indicatorMap.get(indicatorId)
          const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(indicatorId)

          if (!customIndicator && !defaultIndicator) {
            results.push({
              indicatorId,
              output: null,
              warnings: [{ code: 'missing_indicator', message: `${indicatorId} is missing.` }],
              unsupported: { plots: [], styles: [] },
              counts: { plots: 0, markers: 0, triggers: 0 },
              executionError: { message: 'Indicator not found', code: 'missing_indicator' },
            })
            continue
          }

          const pineCode = customIndicator?.pineCode ?? defaultIndicator?.pineCode ?? ''
          const inputMeta = customIndicator
            ? normalizeInputMetaMap(customIndicator.inputMeta)
            : defaultIndicator?.inputMeta
          const inputsOverride = parsedBody.data.inputsMapById?.[indicatorId]
          const baseInputsMap = buildInputsMapFromMeta(inputMeta)
          const inputsMap = inputsOverride ? { ...baseInputsMap, ...inputsOverride } : baseInputsMap

          try {
            const compiled = await executeCompiledIndicator({
              pineCode,
              barsMs,
              inputsMap,
              listing: executionListing,
              interval,
              intervalMs,
              executionTimeoutMs: EXECUTION_TIMEOUT_MS,
              userId: auth.userId,
            })

            if (compiled.unsupportedFeatures && compiled.unsupportedFeatures.length > 0) {
              results.push({
                indicatorId,
                output: null,
                warnings: compiled.warnings,
                unsupported: { plots: [], styles: [] },
                counts: { plots: 0, markers: 0, triggers: 0 },
                executionError: {
                  message: `${compiled.unsupportedFeatures[0]} is not supported`,
                  code: 'unsupported_feature',
                  unsupported: { features: compiled.unsupportedFeatures },
                },
              })
              continue
            }

            if (!compiled.output) {
              results.push({
                indicatorId,
                output: null,
                warnings: compiled.warnings,
                unsupported: compiled.unsupported ?? { plots: [], styles: [] },
                counts: { plots: 0, markers: 0, triggers: 0 },
                executionError: {
                  message: compiled.executionError?.message ?? 'Failed to execute indicator',
                  code: 'runtime_error',
                },
              })
              continue
            }

            const output = compiled.output
            results.push({
              indicatorId,
              output,
              warnings: compiled.warnings,
              unsupported: output.unsupported,
              counts: {
                plots: output.series.length,
                markers: output.markers.length,
                triggers: output.triggers.length,
              },
            })
          } catch (error) {
            if (isLocalVmSaturationLimitError(error)) {
              throw error
            }
            const timedOut = isExecutionTimeoutError(error)
            results.push({
              indicatorId,
              output: null,
              warnings: [],
              unsupported: { plots: [], styles: [] },
              counts: { plots: 0, markers: 0, triggers: 0 },
              executionError: {
                message: timedOut ? 'Execution timed out' : 'Failed to execute indicator',
                code: timedOut ? 'timeout' : 'runtime_error',
              },
            })
          }
        }
        return results
      },
    })

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    if (isCodeExecutionConcurrencyLimitError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: getCodeExecutionConcurrencyLimitMessage(error),
          code: 'concurrency_limit_exceeded',
        },
        { status: error.statusCode }
      )
    }

    if (isLocalVmSaturationLimitError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: getLocalVmSaturationLimitMessage(error),
          code: 'engine_capacity_exceeded',
        },
        { status: error.statusCode }
      )
    }

    logger.error(`[${requestId}] Indicator execute failed`, { error })
    return NextResponse.json(
      { success: false, error: 'Failed to execute indicators' },
      { status: 500 }
    )
  }
}
