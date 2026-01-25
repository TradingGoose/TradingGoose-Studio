import { Script, createContext } from 'vm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import {
  compileIndicatorOutput,
  looksLikeFunctionExpression,
  type IndicatorExecutor,
  type IndicatorExecutionError,
} from '@/lib/indicators/custom/compile'
import { createLogger } from '@/lib/logs/console/logger'
import { generateMockMarketSeries, marketSeriesToKLineData } from '@/lib/market/mock-series'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const logger = createLogger('IndicatorVerifyAPI')

const VerifyIndicatorSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  code: z.string().min(1, 'code is required'),
})

const resolveErrorCode = (message: string) => {
  if (message.includes('typescript')) return 'ts_error'
  if (message.includes('empty code') || message.includes('Draft indicator')) {
    return 'empty_code'
  }
  return 'runtime_error'
}

const parseExecutionError = (
  error: unknown,
  lineOffset: number
): IndicatorExecutionError => {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  let line: number | undefined
  let column: number | undefined

  if (stack) {
    const match = stack.match(/indicator-code\.js:(\d+):(\d+)/)
    if (match) {
      const parsedLine = Number.parseInt(match[1] ?? '', 10)
      const parsedColumn = Number.parseInt(match[2] ?? '', 10)
      if (Number.isFinite(parsedLine)) {
        const adjustedLine = parsedLine - lineOffset
        if (adjustedLine > 0) {
          line = adjustedLine
          column = Number.isFinite(parsedColumn) ? parsedColumn : undefined
        }
      }
    }
  }

  return { message, line, column, stack }
}

const executeIndicatorInVm: IndicatorExecutor = ({ code, context }) => {
  const trimmed = code.trim()
  if (!trimmed) {
    return { error: { message: 'empty code' } }
  }

  const sandbox = {
    dataList: context.dataList,
    indicator: context.indicator,
    Math,
    Date,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  }

  const vmContext = createContext(sandbox)

  if (looksLikeFunctionExpression(trimmed)) {
    try {
      const script = new Script(`(${trimmed})`, { filename: 'indicator-code.js' })
      const fn = script.runInContext(vmContext)
      if (typeof fn !== 'function') {
        return { error: { message: 'Expected a function expression' } }
      }
      return { result: fn(context.dataList, context.indicator) }
    } catch (error) {
      return { error: parseExecutionError(error, 0) }
    }
  }

  try {
    const wrapped = ['(function(dataList, indicator) {', '"use strict";', code, '})'].join(
      '\n'
    )
    const script = new Script(wrapped, { filename: 'indicator-code.js' })
    const fn = script.runInContext(vmContext)
    if (typeof fn !== 'function') {
      return { error: { message: 'Failed to compile indicator function' } }
    }
    return { result: fn(context.dataList, context.indicator) }
  } catch (error) {
    return { error: parseExecutionError(error, 2) }
  }
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
    const parsed = VerifyIndicatorSchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.errors[0]?.message ?? 'Invalid request'
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }

    const { workspaceId, code } = parsed.data

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
    const dataList = marketSeriesToKLineData(series)

    const indicator: CustomIndicatorDefinition = {
      id: `verify-${requestId}`,
      workspaceId,
      userId: authResult.userId,
      name: 'Verification Indicator',
      color: undefined,
      calcCode: code,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const compiled = compileIndicatorOutput(indicator, dataList, executeIndicatorInVm)

    if (!compiled.output) {
      const errorMessage = compiled.errors[0] ?? 'Failed to compile indicator'
      const errorPayload = {
        success: false,
        error: errorMessage,
        code: resolveErrorCode(errorMessage),
        debug: compiled.executionError,
      }
      return NextResponse.json(errorPayload, { status: 400 })
    }

    if (compiled.output.plots.length === 0 && compiled.output.signals.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No plots or signals returned. Did you forget to return an object?',
          code: 'invalid_output',
        },
        { status: 400 }
      )
    }

    const warnings: Array<{ code: string; message: string }> = []

    if (compiled.output.plots.length > 0) {
      const hasPlotValues = compiled.output.plots.some((plot) => hasAnyNumericValue(plot.data))
      if (!hasPlotValues) {
        warnings.push({
          code: 'all_plots_null',
          message: 'All plot values are null. Check your calculations and return values.',
        })
      }
    }

    if (compiled.output.signals.length > 0) {
      const hasSignalValues = compiled.output.signals.some((signal) =>
        hasAnyNumericValue(signal.data)
      )
      if (!hasSignalValues) {
        warnings.push({
          code: 'all_signals_null',
          message: 'All signal values are null. Ensure signals emit price levels.',
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        plotsCount: compiled.output.plots.length,
        signalsCount: compiled.output.signals.length,
        warnings,
        outputPreview: {
          name: compiled.output.name,
          plots: compiled.output.plots.map((plot) => ({
            key: plot.key,
            title: plot.title,
            overlay: plot.overlay,
          })),
          signals: compiled.output.signals.map((signal) => ({ type: signal.type })),
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Indicator verify failed`, { error })
    return NextResponse.json(
      { success: false, error: 'Failed to verify indicator' },
      { status: 500 }
    )
  }
}
