import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateMockMarketSeries } from '@/lib/market/mock-series'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { compileIndicator } from '@/lib/indicators/custom/compile'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'

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
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized indicator verify attempt`)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = VerifySchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.errors[0]?.message ?? 'Invalid request'
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }

    const { workspaceId, pineCode, inputs } = parsed.data

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
    }

    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json(
        { success: false, error: 'Write permission required' },
        { status: 403 }
      )
    }

    const series = generateMockMarketSeries()
    const barsMs = mapMarketSeriesToBarsMs(series).slice(0, MAX_BARS)

    const compilePromise = compileIndicator({
      pineCode,
      barsMs,
      inputsMap: inputs ?? {},
      listingKey: 'mock',
      interval: '1d',
      intervalMs: 86_400_000,
    })

    const compiled = await Promise.race([
      compilePromise,
      new Promise<null>((_resolve, reject) => {
        const timeoutId = setTimeout(() => {
          clearTimeout(timeoutId)
          reject(new Error('Execution timed out'))
        }, VERIFY_EXECUTION_TIMEOUT_MS)
      }),
    ])

    if (!compiled) {
      return NextResponse.json(
        { success: false, error: 'Failed to verify indicator', code: 'runtime_error' },
        { status: 400 }
      )
    }

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
    const drawingsCount = output.drawings.length
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
        drawingsCount,
        signalsCount,
        warnings,
        unsupported: output.unsupported,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('timed out')) {
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
