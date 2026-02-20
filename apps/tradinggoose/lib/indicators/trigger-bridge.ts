import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from 'pinets'
import type {
  IndicatorTriggerSignal,
  PineWarning,
  SeriesMarkerPosition,
} from '@/lib/indicators/types'

export const TG_INDICATOR_TRIGGER_SENTINEL = '__tg_indicator_trigger__'

const TRIGGER_EVENT_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const VALID_SIGNALS = new Set<IndicatorTriggerSignal>(['long', 'short', 'flat'])
const VALID_POSITIONS = new Set<SeriesMarkerPosition>(['aboveBar', 'belowBar', 'inBar'])
const CONTEXT_CALL_PATCH_FLAG = '__tg_indicator_trigger_call_patched__'
const TRIGGER_CALL_ID_PATTERN = /(^|[.$])trigger$/i

type TriggerCollectorState = {
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

const collectorStorage = new AsyncLocalStorage<TriggerCollectorState>()

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

const captureTriggerCall = (context: any, args: unknown[]) => {
  const state = collectorStorage.getStore()
  if (!state) return

  const [eventArg, optionsArg] = args

  const resolvedEvent = resolveCurrentValue(context, eventArg)
  const event = typeof resolvedEvent === 'string' ? resolvedEvent.trim() : ''
  if (!event || !TRIGGER_EVENT_PATTERN.test(event)) {
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
  if (!conditionValue) {
    return
  }

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

  const resolvedTimeSeconds = resolveTimeSeconds(context)
  if (resolvedTimeSeconds === null) {
    pushWarning(
      state,
      'indicator_trigger_invalid_time',
      'trigger call dropped because current bar open time is unavailable.'
    )
    return
  }

  const barIndex = Number.isFinite(context?.idx) ? Number(context.idx) : 0
  const position = resolvePosition(resolveCurrentValue(context, resolvedOptions.position))
  const color = resolveColor(resolveCurrentValue(context, resolvedOptions.color))

  state.events.push({
    event,
    input,
    signal,
    position,
    color,
    time: resolvedTimeSeconds,
    barIndex,
  })
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

const isTriggerCallId = (id: unknown) =>
  typeof id === 'string' && TRIGGER_CALL_ID_PATTERN.test(id.trim())

export const installIndicatorTriggerSentinel = (target: Record<string, unknown>) => {
  const existing = target.trigger
  if (
    typeof existing === 'function' &&
    (existing as unknown as Record<string, unknown>)[TG_INDICATOR_TRIGGER_SENTINEL] === true
  ) {
    return existing
  }

  const sentinel = createIndicatorTriggerSentinel()
  Object.defineProperty(target, 'trigger', {
    value: sentinel,
    writable: true,
    enumerable: false,
    configurable: true,
  })
  return sentinel
}

const patchContextCallForTriggerCapture = () => {
  const contextPrototype = Context.prototype as unknown as Record<string, unknown>
  if (contextPrototype[CONTEXT_CALL_PATCH_FLAG]) {
    return
  }

  const originalCall = contextPrototype.call as
    | ((this: any, fn: (...args: unknown[]) => unknown, id: string, ...args: unknown[]) => unknown)
    | undefined
  if (typeof originalCall !== 'function') {
    throw new Error('PineTS Context.call is unavailable for trigger bridge patching.')
  }

  contextPrototype.call = function patchedIndicatorContextCall(
    this: any,
    fn: (...args: unknown[]) => unknown,
    id: string,
    ...args: unknown[]
  ) {
    const globalTrigger = (globalThis as Record<string, unknown>).trigger
    const markedAsTrigger =
      typeof fn === 'function' &&
      ((fn as unknown as Record<string, unknown>)[TG_INDICATOR_TRIGGER_SENTINEL] === true ||
        fn === globalTrigger)
    const triggerById = isTriggerCallId(id)

    if (markedAsTrigger || triggerById) {
      captureTriggerCall(this, args)
      return undefined
    }

    return originalCall.apply(this, [fn, id, ...args])
  }

  Object.defineProperty(contextPrototype, CONTEXT_CALL_PATCH_FLAG, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  })
}

export const bootstrapIndicatorTriggerBridge = (target: Record<string, unknown>) => {
  installIndicatorTriggerSentinel(target)
  patchContextCallForTriggerCapture()
}

export const runWithIndicatorTriggerCollector = async <T>(
  runner: () => Promise<T> | T
): Promise<{
  result: T
  events: IndicatorTriggerCapture[]
  warnings: PineWarning[]
}> => {
  const initialState: TriggerCollectorState = {
    events: [],
    warnings: [],
  }

  return collectorStorage.run(initialState, async () => {
    const result = await runner()
    return {
      result,
      events: [...initialState.events],
      warnings: [...initialState.warnings],
    }
  })
}
