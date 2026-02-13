import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import { createLogger } from '@/lib/logs/console/logger'
import { generateMockMarketSeries } from '@/lib/market/mock-series'
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

const logger = createLogger('IndicatorVerifyAPI')
const VERIFY_EXECUTION_TIMEOUT_MS = 8000
const MAX_BARS = 500

const VerifySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  pineCode: z.string().min(1, 'pineCode is required'),
  inputs: z.record(z.any()).optional(),
})

const resolveErrorCode = (message: string) => {
  if (message.includes('typescript')) return 'ts_error'
  if (message.includes('empty code')) return 'empty_code'
  return 'runtime_error'
}

const hasAnyNumericValue = (values: Array<number | null>) =>
  values.some((value) => typeof value === 'number' && Number.isFinite(value))

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'verify',
    })
    if ('response' in auth) return auth.response

    const parsedBody = await parseIndicatorRequestBody({ request, schema: VerifySchema })
    if ('response' in parsedBody) return parsedBody.response

    const { workspaceId, pineCode, inputs } = parsedBody.data

    const permissionError = await getWorkspaceWritePermissionError(auth.userId, workspaceId)
    if (permissionError) return permissionError

    const userSubscription = await getHighestPrioritySubscription(auth.userId)
    const { useE2B, e2bTemplate, e2bKeepWarmMs } = resolveIndicatorRuntimeConfig(
      userSubscription?.plan
    )

    const series = generateMockMarketSeries()
    const barsMs = mapMarketSeriesToBarsMs(series).slice(0, MAX_BARS)

    const compiled = await executeCompiledIndicator({
      pineCode,
      barsMs,
      inputsMap: inputs ?? {},
      listingKey: 'mock',
      interval: '1d',
      intervalMs: 86_400_000,
      useE2B,
      e2bTemplate,
      e2bKeepWarmMs,
      executionTimeoutMs: VERIFY_EXECUTION_TIMEOUT_MS,
    })

    if (compiled.unsupportedFeatures && compiled.unsupportedFeatures.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `${compiled.unsupportedFeatures[0]} is not supported`,
          code: 'unsupported_feature',
          unsupported: { features: compiled.unsupportedFeatures },
        },
        { status: 400 }
      )
    }

    if (!compiled.output) {
      const message = compiled.executionError?.message ?? 'Failed to compile indicator'
      const errorPayload = {
        success: false,
        error: message,
        code: resolveErrorCode(message),
      }
      logger.warn(`[${requestId}] Indicator verify failed`, {
        executionError: compiled.executionError,
      })
      return NextResponse.json(errorPayload, { status: 400 })
    }

    const output = compiled.output
    const plotsCount = output.series.length
    const markersCount = output.markers.length
    const signalsCount = output.signals.length

    if (plotsCount === 0 && markersCount === 0 && signalsCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No plots or markers returned. Did you forget to plot?',
          code: 'invalid_output',
        },
        { status: 400 }
      )
    }

    const warnings = [...compiled.warnings]

    if (plotsCount > 0) {
      const hasPlotValues = output.series.some((plot) =>
        hasAnyNumericValue(plot.points.map((point) => point.value))
      )
      if (!hasPlotValues) {
        warnings.push({
          code: 'all_plots_null',
          message: 'All plot values are null. Check your calculations and return values.',
        })
      }
    }

    if (markersCount > 0) {
      const hasMarkerValues = output.markers.some(
        (marker) => typeof marker.time === 'number' && Number.isFinite(marker.time)
      )
      if (!hasMarkerValues) {
        warnings.push({
          code: 'all_markers_null',
          message: 'All markers are null. Ensure plots emit valid values.',
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        plotsCount,
        markersCount,
        signalsCount,
        warnings,
        unsupported: output.unsupported,
      },
    })
  } catch (error) {
    if (isExecutionTimeoutError(error)) {
      return NextResponse.json(
        { success: false, error: 'Verification timed out', code: 'runtime_error' },
        { status: 408 }
      )
    }
    logger.error(`[${requestId}] Indicator verify failed`, { error })
    return NextResponse.json(
      { success: false, error: 'Failed to verify indicator' },
      { status: 500 }
    )
  }
}
