import {
  DEFAULT_INDICATOR_RUNTIME_IDS,
  resolveDefaultIndicatorRuntimeEntry,
} from '@/lib/indicators/default/runtime'
import { buildInputsMapFromMeta } from '@/lib/indicators/input-meta'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import type { MarketSeries } from '@/providers/market/types'
import { executeIndicatorInLocalVm } from './local-executor'

export const FUNCTION_INDICATOR_USAGE_HINT =
  'Use indicator.<ID>(marketSeries) with MarketSeries output from the Historical Data block (e.g. indicator.RSI(<historical_data>)).'

export const FUNCTION_INDICATOR_INVALID_OPTIONS_MESSAGE =
  'Indicator options must be an object. Use indicator.<ID>(marketSeries, { Length: 7 }) or indicator.<ID>(marketSeries, { inputs: { ... } }).'

export const FUNCTION_INDICATOR_MARKET_SERIES_ERROR_PREFIX =
  'Indicator runtime expects MarketSeries data from Historical Data block.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const resolveIndicatorInputOverrides = (
  rawOptions: unknown
): Record<string, unknown> | undefined => {
  if (rawOptions === undefined || rawOptions === null) return undefined
  if (!isRecord(rawOptions)) {
    throw new Error(FUNCTION_INDICATOR_INVALID_OPTIONS_MESSAGE)
  }

  if (!Object.hasOwn(rawOptions, 'inputs')) return rawOptions

  if (rawOptions.inputs === undefined || rawOptions.inputs === null) return undefined
  if (!isRecord(rawOptions.inputs)) {
    throw new Error(FUNCTION_INDICATOR_INVALID_OPTIONS_MESSAGE)
  }
  return rawOptions.inputs
}

const parseMarketSeriesForIndicator = (input: unknown): MarketSeries => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Array.isArray((input as MarketSeries).bars) ||
    (input as MarketSeries).bars.length === 0
  ) {
    throw new Error(
      `${FUNCTION_INDICATOR_MARKET_SERIES_ERROR_PREFIX} ${FUNCTION_INDICATOR_USAGE_HINT}`
    )
  }
  return input as MarketSeries
}

const executeFunctionIndicator = async ({
  alias,
  marketSeriesInput,
  rawOptions,
  requestId,
  onWarn,
}: {
  alias: string
  marketSeriesInput: unknown
  rawOptions?: unknown
  requestId: string
  onWarn: (message: string, meta: Record<string, unknown>) => void
}) => {
  const aliasKey = alias.trim()
  const entry = resolveDefaultIndicatorRuntimeEntry(aliasKey)
  if (!entry) {
    throw new Error(`Unknown indicator "${aliasKey || alias}".`)
  }

  const series = parseMarketSeriesForIndicator(marketSeriesInput)
  const inputOverrides = resolveIndicatorInputOverrides(rawOptions)
  const barsMs = mapMarketSeriesToBarsMs(series)

  if (barsMs.length === 0) {
    throw new Error('MarketSeries has no valid bars after normalization.')
  }

  try {
    const inputsMap = buildInputsMapFromMeta(entry.inputMeta, inputOverrides)
    const runResult = await executeIndicatorInLocalVm({
      barsMs,
      inputsMap,
      listing: series.listing ?? null,
      code: entry.pineCode,
    })
    const context = runResult.context
    const plots = context?.plots && typeof context.plots === 'object' ? context.plots : {}
    const indicatorMeta =
      context?.indicator && typeof context.indicator === 'object' ? context.indicator : {}

    return {
      indicatorId: entry.id,
      indicatorName: entry.name,
      plots,
      indicator: indicatorMeta,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onWarn(`[${requestId}] indicator.${entry.id} failed`, { error: message })
    throw new Error(`indicator.${entry.id} failed: ${message}`)
  }
}

export const createFunctionIndicatorRuntime = ({
  requestId,
  onWarn,
}: {
  requestId: string
  onWarn: (message: string, meta: Record<string, unknown>) => void
}) => {
  const runtime: Record<string, unknown> = {
    list: () => [...DEFAULT_INDICATOR_RUNTIME_IDS],
  }

  return new Proxy(runtime, {
    get(target, prop) {
      if (prop === 'list') return target.list
      if (typeof prop !== 'string') return undefined
      return (marketSeriesInput: unknown, rawOptions?: unknown) =>
        executeFunctionIndicator({
          alias: prop,
          marketSeriesInput,
          rawOptions,
          requestId,
          onWarn,
        })
    },
  })
}
