import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ExecutionGateError,
  enforceServerExecutionRateLimit,
  getExecutionConcurrencyLimitMessage,
  isExecutionConcurrencyBackendUnavailableError,
  isExecutionConcurrencyLimitError,
  withExecutionConcurrencyLimit,
} from '@/lib/execution/execution-concurrency-limit'
import { getLocalVmSaturationLimitMessage, isLocalVmSaturationLimitError } from '@/lib/execution/local-saturation-limit'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import { detectTriggerUsage } from '@/lib/indicators/trigger-detection'
import { createLogger } from '@/lib/logs/console/logger'
import { generateMockMarketSeries } from '@/lib/market/mock-series'
import { generateRequestId } from '@/lib/utils'
import { RateLimitError } from '@/services/queue'
import {
  authenticateIndicatorRequest,
  getWorkspaceWritePermissionError,
  isExecutionTimeoutError,
  parseIndicatorRequestBody,
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
    const triggerUsageDetected = detectTriggerUsage(pineCode)

    const permissionError = await getWorkspaceWritePermissionError(auth.userId, workspaceId)
    if (permissionError) return permissionError

    await enforceServerExecutionRateLimit({
      actorUserId: auth.userId,
      authType: auth.authType,
      workspaceId,
      isAsync: false,
      logger,
      requestId,
      source: 'indicator verify',
    })

    const series = generateMockMarketSeries()
    const barsMs = mapMarketSeriesToBarsMs(series).slice(0, MAX_BARS)

    const compiled = await withExecutionConcurrencyLimit({
      userId: auth.userId,
      workspaceId,
      task: async () =>
        await executeCompiledIndicator({
          pineCode,
          barsMs,
          inputsMap: inputs ?? {},
          listing: series.listing ?? null,
          interval: '1d',
          intervalMs: 86_400_000,
          executionTimeoutMs: VERIFY_EXECUTION_TIMEOUT_MS,
          userId: auth.userId,
        }),
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
    const triggersCount = output.triggers.length

    if (plotsCount === 0 && markersCount === 0 && triggersCount === 0 && !triggerUsageDetected) {
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
    const triggerOnly =
      triggerUsageDetected && plotsCount === 0 && markersCount === 0 && triggersCount === 0

    if (triggerOnly) {
      warnings.push({
        code: 'trigger_only_script',
        message: 'Script uses trigger(...) without plots/markers/triggers, which is valid.',
      })
    }

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
        triggersCount,
        triggerUsageDetected,
        triggerOnly,
        warnings,
        unsupported: output.unsupported,
      },
    })
  } catch (error) {
    if (error instanceof ExecutionGateError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: 'usage_limit_exceeded',
        },
        { status: error.statusCode }
      )
    }

    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: 'rate_limit_exceeded',
        },
        { status: error.statusCode }
      )
    }

    if (isExecutionConcurrencyLimitError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: getExecutionConcurrencyLimitMessage(error),
          code: 'execution_concurrency_limit_exceeded',
        },
        { status: error.statusCode }
      )
    }

    if (isExecutionConcurrencyBackendUnavailableError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: 'execution_limiter_unavailable',
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
