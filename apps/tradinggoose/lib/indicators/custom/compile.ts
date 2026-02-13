import { executeInE2B } from '@/lib/execution/e2b'
import { CodeLanguage } from '@/lib/execution/languages'
import { buildPineTSE2BSingleIndicatorScript } from '@/lib/indicators/execution/e2b-script-builder'
import { executeIndicatorInLocalVm } from '@/lib/indicators/execution/local-executor'
import {
  coerceIndicatorCount,
  inferIndicatorOptionsFromPineCode,
  normalizeIndicatorOptions,
  resolveIndicatorTimeframeMs,
} from '@/lib/indicators/indicator-options'
import { normalizeContext } from '@/lib/indicators/normalize-context'
import { normalizeIndicatorCode } from '@/lib/indicators/normalize-indicator-code'
import { aggregateBarsMs, buildIndexMaps, normalizeBarsMs } from '@/lib/indicators/series-data'
import type {
  BarMs,
  NormalizedPineOutput,
  PineUnsupportedInfo,
  PineWarning,
} from '@/lib/indicators/types'
import { detectUnsupportedFeatures } from '@/lib/indicators/unsupported'

export type PineExecutionError = {
  message: string
  line?: number
  column?: number
  stack?: string
}

export type PineCompileResult = {
  output: NormalizedPineOutput | null
  warnings: PineWarning[]
  unsupported: PineUnsupportedInfo
  transpiledCode?: string
  executionError?: PineExecutionError
  unsupportedFeatures?: string[]
}

const DEFAULT_E2B_INDICATOR_TIMEOUT_MS = 15000

const parseExecutionError = (error: unknown, lineOffset: number): PineExecutionError => {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const executeIndicatorInE2B = async ({
  normalizedCode,
  barsMs,
  inputsMap,
  listingKey,
  interval,
  timeoutMs,
  e2bTemplate,
  e2bKeepWarmMs,
}: {
  normalizedCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listingKey?: string
  interval?: string
  timeoutMs: number
  e2bTemplate?: string
  e2bKeepWarmMs?: number
}): Promise<{ context: any; transpiledCode?: string }> => {
  const codeForE2B = buildPineTSE2BSingleIndicatorScript({
    normalizedCode,
    barsMs,
    inputsMap,
    listingKey,
    interval,
  })

  const { result, stdout, error } = await executeInE2B({
    code: codeForE2B,
    language: CodeLanguage.JavaScript,
    timeoutMs,
    template: e2bTemplate,
    keepWarmMs: e2bKeepWarmMs,
  })

  if (error) {
    const detailedError = stdout && stdout.trim().length > 0 ? `${error}\n${stdout}` : error
    throw new Error(detailedError)
  }

  if (!isRecord(result)) {
    throw new Error('Invalid E2B indicator execution response')
  }

  const resultContext = isRecord(result.context) ? result.context : {}
  const plots = isRecord(resultContext.plots) ? resultContext.plots : {}
  const indicator = resultContext.indicator

  return {
    context: {
      plots,
      indicator,
    },
    transpiledCode: typeof result.transpiledCode === 'string' ? result.transpiledCode : undefined,
  }
}

const toSeconds = (ms: number) => Math.floor(ms / 1000)

const expandSeriesPointsToBase = (
  points: NormalizedPineOutput['series'][number]['points'],
  baseOpenTimeMsByIndex: number[],
  timeframeGaps: boolean
) => {
  if (baseOpenTimeMsByIndex.length === 0) return points
  const baseTimesSec = baseOpenTimeMsByIndex.map(toSeconds)
  const expanded: NormalizedPineOutput['series'][number]['points'] = []
  let pointIndex = 0
  let lastPoint: NormalizedPineOutput['series'][number]['points'][number] | null = null

  baseTimesSec.forEach((timeSec) => {
    while (pointIndex < points.length && points[pointIndex]!.time <= timeSec) {
      lastPoint = points[pointIndex] ?? null
      pointIndex += 1
    }

    if (!lastPoint || typeof lastPoint.value !== 'number' || !Number.isFinite(lastPoint.value)) {
      expanded.push({ time: timeSec, value: null })
      return
    }

    if (timeframeGaps && lastPoint.time !== timeSec) {
      expanded.push({ time: timeSec, value: null })
      return
    }

    expanded.push({
      time: timeSec,
      value: lastPoint.value,
      ...(lastPoint.color ? { color: lastPoint.color } : null),
    })
  })

  return expanded
}

const expandOutputToBase = (
  output: NormalizedPineOutput,
  baseOpenTimeMsByIndex: number[],
  timeframeGaps: boolean
): NormalizedPineOutput => {
  return {
    ...output,
    series: output.series.map((entry) => ({
      ...entry,
      points: expandSeriesPointsToBase(entry.points, baseOpenTimeMsByIndex, timeframeGaps),
    })),
  }
}

const applyIndicatorLimits = (
  output: NormalizedPineOutput,
  warnings: PineWarning[]
): NormalizedPineOutput => {
  const indicator = output.indicator
  if (!indicator) return output

  let series = output.series
  let markers = output.markers

  const maxLines = coerceIndicatorCount(indicator.max_lines_count)
  if (maxLines && series.length > maxLines) {
    series = series.slice(0, maxLines)
    warnings.push({
      code: 'indicator_max_lines_count',
      message: `Indicator plots truncated to ${maxLines} (max_lines_count).`,
    })
  }

  const maxLabels = coerceIndicatorCount(indicator.max_labels_count)
  if (maxLabels && markers.length > maxLabels) {
    markers = markers.slice(-maxLabels)
    warnings.push({
      code: 'indicator_max_labels_count',
      message: `Indicator markers truncated to ${maxLabels} (max_labels_count).`,
    })
  }

  return {
    ...output,
    series,
    markers,
  }
}

export async function compileIndicator({
  pineCode,
  barsMs,
  inputsMap,
  listingKey,
  interval,
  intervalMs,
  useE2B = false,
  executionTimeoutMs = DEFAULT_E2B_INDICATOR_TIMEOUT_MS,
  e2bTemplate,
  e2bKeepWarmMs,
}: {
  pineCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listingKey?: string
  interval?: string
  intervalMs?: number | null
  useE2B?: boolean
  executionTimeoutMs?: number
  e2bTemplate?: string
  e2bKeepWarmMs?: number
}): Promise<PineCompileResult> {
  const inferredIndicatorOptions = inferIndicatorOptionsFromPineCode(pineCode)
  const unsupportedFeatures = detectUnsupportedFeatures(pineCode)
  if (unsupportedFeatures.length > 0) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      unsupportedFeatures,
    }
  }

  const normalizedBars = normalizeBarsMs(barsMs, intervalMs)
  let baseBars = normalizedBars
  let executionBars = normalizedBars
  const compileWarnings: PineWarning[] = []

  const timeframeMs = resolveIndicatorTimeframeMs(inferredIndicatorOptions?.timeframe)
  const baseIntervalMs = intervalMs ?? null
  const shouldResample =
    typeof timeframeMs === 'number' &&
    Number.isFinite(timeframeMs) &&
    timeframeMs > 0 &&
    typeof baseIntervalMs === 'number' &&
    Number.isFinite(baseIntervalMs) &&
    timeframeMs > baseIntervalMs

  if (shouldResample && timeframeMs) {
    executionBars = aggregateBarsMs(baseBars, timeframeMs)
  } else if (
    timeframeMs &&
    typeof baseIntervalMs === 'number' &&
    Number.isFinite(baseIntervalMs) &&
    timeframeMs < baseIntervalMs
  ) {
    compileWarnings.push({
      code: 'indicator_timeframe_unsupported',
      message:
        'Indicator timeframe is lower than the chart interval; running on chart bars instead.',
    })
  }

  const calcBarsCount = coerceIndicatorCount(inferredIndicatorOptions?.calc_bars_count ?? undefined)
  if (calcBarsCount && executionBars.length > calcBarsCount) {
    executionBars = executionBars.slice(-calcBarsCount)
    const cutoffTime = executionBars[0]?.openTime
    if (typeof cutoffTime === 'number') {
      baseBars = baseBars.filter((bar) => bar.openTime >= cutoffTime)
    }
  }

  const maxBarsBack = coerceIndicatorCount(inferredIndicatorOptions?.max_bars_back ?? undefined)
  if (maxBarsBack && executionBars.length < maxBarsBack) {
    compileWarnings.push({
      code: 'indicator_max_bars_back',
      message: `Indicator max_bars_back (${maxBarsBack}) exceeds available bars (${executionBars.length}).`,
    })
  }

  const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(executionBars)
  const normalizedCode = normalizeIndicatorCode(pineCode)

  if (normalizedCode.error) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      transpiledCode: normalizedCode.transpiledCode,
      executionError: { message: normalizedCode.error },
    }
  }

  if (!normalizedCode.code) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      transpiledCode: normalizedCode.transpiledCode,
      executionError: { message: 'empty code' },
    }
  }

  let executionError: PineExecutionError | undefined
  let pineContext: any
  let transpiledCode: string | undefined
  const executionInterval =
    shouldResample && inferredIndicatorOptions?.timeframe
      ? inferredIndicatorOptions.timeframe
      : interval

  try {
    if (useE2B) {
      const result = await executeIndicatorInE2B({
        normalizedCode: normalizedCode.code,
        barsMs: executionBars,
        inputsMap,
        listingKey,
        interval: executionInterval,
        timeoutMs: executionTimeoutMs,
        e2bTemplate,
        e2bKeepWarmMs,
      })
      pineContext = result.context
      transpiledCode = result.transpiledCode
    } else {
      const result = await executeIndicatorInLocalVm({
        barsMs: executionBars,
        inputsMap,
        listingKey,
        interval: executionInterval,
        code: normalizedCode.code,
        codeFormat: 'functionExpression',
      })
      pineContext = result.context
      transpiledCode = typeof result.transpiledCode === 'string' ? result.transpiledCode : undefined
    }
  } catch (error) {
    executionError = parseExecutionError(error, 0)
  }

  if (!pineContext || executionError) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      transpiledCode,
      executionError: executionError ?? { message: 'Failed to execute PineTS code.' },
    }
  }

  const normalized = normalizeContext({
    context: pineContext,
    indexByOpenTimeMs,
    openTimeMsByIndex,
  })

  const runtimeIndicatorOptions = normalizeIndicatorOptions(pineContext?.indicator, {
    dropDefaults: true,
  })
  const mergedIndicatorOptions = {
    ...(inferredIndicatorOptions ?? {}),
    ...(runtimeIndicatorOptions ?? {}),
  }
  const indicatorOptions =
    Object.keys(mergedIndicatorOptions).length > 0 ? mergedIndicatorOptions : undefined

  const timeframeGaps =
    typeof indicatorOptions?.timeframe_gaps === 'boolean' ? indicatorOptions.timeframe_gaps : true

  let output: NormalizedPineOutput = {
    ...normalized.output,
    indicator: indicatorOptions,
  }

  if (shouldResample) {
    output = expandOutputToBase(
      output,
      baseBars.map((bar) => bar.openTime),
      timeframeGaps
    )
  }

  output = applyIndicatorLimits(output, compileWarnings)

  return {
    output,
    warnings: [...normalized.warnings, ...compileWarnings],
    unsupported: output.unsupported,
    transpiledCode,
  }
}
