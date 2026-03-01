import { executeInE2B, isE2BWarmSandboxLimitError } from '@/lib/execution/e2b'
import { isLocalVmSaturationLimitError } from '@/lib/execution/local-saturation-limit'
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
import {
  extractFillOptionOverrides,
  normalizeIndicatorCode,
} from '@/lib/indicators/normalize-indicator-code'
import { aggregateBarsMs, buildIndexMaps, normalizeBarsMs } from '@/lib/indicators/series-data'
import { detectTriggerUsage } from '@/lib/indicators/trigger-detection'
import type {
  BarMs,
  NormalizedPineOutput,
  NormalizedPineSignal,
  PineUnsupportedInfo,
  PineWarning,
} from '@/lib/indicators/types'
import { detectUnsupportedFeatures } from '@/lib/indicators/unsupported'
import type { ListingIdentity } from '@/lib/listing/identity'

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
  listing,
  interval,
  timeoutMs,
  e2bTemplate,
  e2bKeepWarmMs,
  e2bUserScope,
}: {
  normalizedCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: string
  timeoutMs: number
  e2bTemplate?: string
  e2bKeepWarmMs?: number
  e2bUserScope?: string
}): Promise<{
  context: any
  transpiledCode?: string
  triggerSignals: NormalizedPineSignal[]
  triggerWarnings: PineWarning[]
}> => {
  const codeForE2B = buildPineTSE2BSingleIndicatorScript({
    normalizedCode,
    barsMs,
    inputsMap,
    listing,
    interval,
  })

  const { result, stdout, error } = await executeInE2B({
    code: codeForE2B,
    language: CodeLanguage.JavaScript,
    timeoutMs,
    template: e2bTemplate,
    keepWarmMs: e2bKeepWarmMs,
    userScope: e2bUserScope,
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
    triggerSignals: Array.isArray(result.triggerSignals)
      ? (result.triggerSignals as NormalizedPineSignal[])
      : [],
    triggerWarnings: Array.isArray(result.triggerWarnings)
      ? (result.triggerWarnings as PineWarning[])
      : [],
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

const expandFillPointsToBase = (
  points: NormalizedPineOutput['fills'][number]['points'],
  baseOpenTimeMsByIndex: number[],
  timeframeGaps: boolean
) => {
  if (baseOpenTimeMsByIndex.length === 0) return points
  const baseTimesSec = baseOpenTimeMsByIndex.map(toSeconds)
  const expanded: NormalizedPineOutput['fills'][number]['points'] = []
  let pointIndex = 0
  let lastPoint: NormalizedPineOutput['fills'][number]['points'][number] | null = null

  baseTimesSec.forEach((timeSec) => {
    while (pointIndex < points.length && points[pointIndex]!.time <= timeSec) {
      lastPoint = points[pointIndex] ?? null
      pointIndex += 1
    }

    if (
      !lastPoint ||
      !Number.isFinite(lastPoint.upper) ||
      !Number.isFinite(lastPoint.lower) ||
      (timeframeGaps && lastPoint.time !== timeSec)
    ) {
      return
    }

    expanded.push({
      time: timeSec,
      upper: lastPoint.upper,
      lower: lastPoint.lower,
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
    fills: output.fills.map((entry) => ({
      ...entry,
      points: expandFillPointsToBase(entry.points, baseOpenTimeMsByIndex, timeframeGaps),
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
  let fills = output.fills
  let markers = output.markers

  const maxLines = coerceIndicatorCount(indicator.max_lines_count)
  if (maxLines && series.length > maxLines) {
    series = series.slice(0, maxLines)
    const retainedPlotTitles = new Set(series.map((entry) => entry.plot.title))
    fills = fills.filter((fill) => {
      if (fill.upperPlotTitle && !retainedPlotTitles.has(fill.upperPlotTitle)) return false
      if (fill.lowerPlotTitle && !retainedPlotTitles.has(fill.lowerPlotTitle)) return false
      return true
    })
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
    fills,
    markers,
  }
}

export async function compileIndicator({
  pineCode,
  barsMs,
  inputsMap,
  listing,
  interval,
  intervalMs,
  useE2B = false,
  executionTimeoutMs = DEFAULT_E2B_INDICATOR_TIMEOUT_MS,
  e2bTemplate,
  e2bKeepWarmMs,
  userId,
}: {
  pineCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: string
  intervalMs?: number | null
  useE2B?: boolean
  executionTimeoutMs?: number
  e2bTemplate?: string
  e2bKeepWarmMs?: number
  userId?: string
}): Promise<PineCompileResult> {
  const triggerUsageDetected = detectTriggerUsage(pineCode)
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
  const fillOptionOverrides = extractFillOptionOverrides(pineCode)
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
  let triggerSignals: NormalizedPineSignal[] = []
  let triggerWarnings: PineWarning[] = []
  let ranInE2B = false
  const executionInterval =
    shouldResample && inferredIndicatorOptions?.timeframe
      ? inferredIndicatorOptions.timeframe
      : interval
  const executeInLocalVm = async () => {
    const result = await executeIndicatorInLocalVm({
      barsMs: executionBars,
      inputsMap,
      listing,
      interval: executionInterval,
      code: normalizedCode.code,
      codeFormat: 'functionExpression',
      ownerKey: userId ? `user:${userId}` : undefined,
    })
    pineContext = result.context
    transpiledCode = typeof result.transpiledCode === 'string' ? result.transpiledCode : undefined
    triggerSignals = Array.isArray(result.triggerSignals)
      ? (result.triggerSignals as NormalizedPineSignal[])
      : []
    triggerWarnings = Array.isArray(result.triggerWarnings)
      ? (result.triggerWarnings as PineWarning[])
      : []
  }

  try {
    if (useE2B) {
      try {
        const result = await executeIndicatorInE2B({
          normalizedCode: normalizedCode.code,
          barsMs: executionBars,
          inputsMap,
          listing,
          interval: executionInterval,
          timeoutMs: executionTimeoutMs,
          e2bTemplate,
          e2bKeepWarmMs,
          e2bUserScope: userId,
        })
        pineContext = result.context
        transpiledCode = result.transpiledCode
        triggerSignals = result.triggerSignals
        triggerWarnings = result.triggerWarnings
        ranInE2B = true
      } catch (error) {
        if (!isE2BWarmSandboxLimitError(error)) {
          throw error
        }
        await executeInLocalVm()
      }

      if (ranInE2B && triggerUsageDetected && triggerSignals.length === 0) {
        try {
          const fallback = await executeIndicatorInLocalVm({
            barsMs: executionBars,
            inputsMap,
            listing,
            interval: executionInterval,
            code: normalizedCode.code,
            codeFormat: 'functionExpression',
            ownerKey: userId ? `user:${userId}` : undefined,
          })
          const fallbackSignals = Array.isArray(fallback.triggerSignals)
            ? (fallback.triggerSignals as NormalizedPineSignal[])
            : []
          const fallbackWarnings = Array.isArray(fallback.triggerWarnings)
            ? (fallback.triggerWarnings as PineWarning[])
            : []
          if (fallbackSignals.length > 0) {
            triggerSignals = fallbackSignals
          }
          if (fallbackWarnings.length > 0) {
            triggerWarnings = [...triggerWarnings, ...fallbackWarnings]
          }
        } catch {
          // Best-effort fallback for trigger capture parity when E2B runtime can't emit trigger calls.
        }
      }
    } else {
      await executeInLocalVm()
    }
  } catch (error) {
    if (isLocalVmSaturationLimitError(error)) {
      throw error
    }
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
    triggerSignals,
    fillOptionOverrides,
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
    warnings: [...normalized.warnings, ...triggerWarnings, ...compileWarnings],
    unsupported: output.unsupported,
    transpiledCode,
  }
}
