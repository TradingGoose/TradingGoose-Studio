import type {
  IndicatorTriggerSignal,
  PineWarning,
  SeriesMarkerPosition,
} from '@/lib/indicators/types'

export const TG_INDICATOR_TRIGGER_SENTINEL = '__tg_indicator_trigger__'
export const INDICATOR_TRIGGER_EVENT_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
export const INDICATOR_TRIGGER_VALID_SIGNALS = ['long', 'short', 'flat'] as const
export const INDICATOR_TRIGGER_VALID_POSITIONS = ['aboveBar', 'belowBar', 'inBar'] as const

const VALID_SIGNALS = new Set<IndicatorTriggerSignal>(INDICATOR_TRIGGER_VALID_SIGNALS)
const VALID_POSITIONS = new Set<SeriesMarkerPosition>(INDICATOR_TRIGGER_VALID_POSITIONS)
const TRIGGER_CALL_ID_PATTERN = /(^|[.$])trigger$/i

export type TriggerCollectorState = {
  events: IndicatorTriggerCapture[]
  warnings: PineWarning[]
}

export type IndicatorTriggerCapture = {
  event: string
  input: string
  signal: IndicatorTriggerSignal
  position: SeriesMarkerPosition
  color?: string
  time: number
  barIndex: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pushWarning = (state: TriggerCollectorState, code: string, message: string) => {
  state.warnings.push({ code, message })
}

const resolveCurrentValue = (context: any, value: unknown): unknown => {
  try {
    if (context && typeof context.get === 'function') {
      return context.get(value, 0)
    }
  } catch {
    return undefined
  }
  return value
}

const resolveTimeSeconds = (context: any): number | null => {
  const primary = resolveCurrentValue(context, context?.data?.openTime)
  if (typeof primary === 'number' && Number.isFinite(primary)) {
    return Math.floor(primary / 1000)
  }

  const fallback = resolveCurrentValue(context, context?.data?.time)
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.floor(fallback / 1000)
  }

  return null
}

const resolvePosition = (rawValue: unknown): SeriesMarkerPosition => {
  if (typeof rawValue !== 'string') return 'aboveBar'
  const normalized = rawValue.trim() as SeriesMarkerPosition
  if (!VALID_POSITIONS.has(normalized)) return 'aboveBar'
  return normalized
}

const resolveColor = (rawValue: unknown): string | undefined => {
  if (typeof rawValue !== 'string') return undefined
  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const createIndicatorTriggerSentinel = () => {
  const sentinel = function indicatorTriggerSentinelNoop() {
    return undefined
  } as ((...args: unknown[]) => void) & Record<string, unknown>

  Object.defineProperty(sentinel, TG_INDICATOR_TRIGGER_SENTINEL, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  })

  return sentinel
}

export const isIndicatorTriggerCallId = (id: unknown) =>
  typeof id === 'string' && TRIGGER_CALL_ID_PATTERN.test(id.trim())

export const captureIndicatorTriggerCall = (
  state: TriggerCollectorState,
  context: any,
  args: unknown[]
) => {
  const [eventArg, optionsArg] = args

  const resolvedEvent = resolveCurrentValue(context, eventArg)
  const event = typeof resolvedEvent === 'string' ? resolvedEvent.trim() : ''
  if (!event || !INDICATOR_TRIGGER_EVENT_PATTERN.test(event)) {
    pushWarning(
      state,
      'indicator_trigger_invalid_event',
      'trigger(event, options) requires event to match /^[a-z][a-z0-9_]{0,63}$/'
    )
    return
  }

  const resolvedOptions = resolveCurrentValue(context, optionsArg)
  if (!isRecord(resolvedOptions)) {
    pushWarning(
      state,
      'indicator_trigger_invalid_options',
      'trigger(event, options) requires an options object.'
    )
    return
  }

  let conditionValue: unknown
  try {
    conditionValue = resolveCurrentValue(context, resolvedOptions.condition)
  } catch {
    pushWarning(
      state,
      'indicator_trigger_condition_unresolved',
      'trigger options.condition could not be resolved for current bar.'
    )
    return
  }
  if (!conditionValue) return

  const resolvedInput = resolveCurrentValue(context, resolvedOptions.input)
  const input = typeof resolvedInput === 'string' ? resolvedInput.trim() : ''
  if (!input) {
    pushWarning(
      state,
      'indicator_trigger_invalid_input',
      'trigger options.input is required and must be a non-empty string.'
    )
    return
  }

  const resolvedSignal = resolveCurrentValue(context, resolvedOptions.signal)
  const signal =
    typeof resolvedSignal === 'string' ? (resolvedSignal.trim() as IndicatorTriggerSignal) : null
  if (!signal || !VALID_SIGNALS.has(signal)) {
    pushWarning(
      state,
      'indicator_trigger_invalid_signal',
      'trigger options.signal must be one of long | short | flat.'
    )
    return
  }

  const time = resolveTimeSeconds(context)
  if (time === null) {
    pushWarning(
      state,
      'indicator_trigger_invalid_time',
      'trigger call dropped because current bar open time is unavailable.'
    )
    return
  }

  state.events.push({
    event,
    input,
    signal,
    time,
    barIndex: Number.isFinite(context?.idx) ? Number(context.idx) : 0,
    position: resolvePosition(resolveCurrentValue(context, resolvedOptions.position)),
    color: resolveColor(resolveCurrentValue(context, resolvedOptions.color)),
  })
}
