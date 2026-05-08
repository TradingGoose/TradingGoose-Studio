import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from 'pinets'
import {
  captureIndicatorTriggerCall,
  createIndicatorTriggerSentinel,
  type IndicatorTriggerCapture,
  isIndicatorTriggerCallId,
  TG_INDICATOR_TRIGGER_SENTINEL,
  type TriggerCollectorState,
} from '@/lib/indicators/trigger-capture'
import type { PineWarning } from '@/lib/indicators/types'

export {
  createIndicatorTriggerSentinel,
  INDICATOR_TRIGGER_EVENT_PATTERN,
  INDICATOR_TRIGGER_VALID_POSITIONS,
  INDICATOR_TRIGGER_VALID_SIGNALS,
  type IndicatorTriggerCapture,
  TG_INDICATOR_TRIGGER_SENTINEL,
} from '@/lib/indicators/trigger-capture'

const CONTEXT_CALL_PATCH_FLAG = '__tg_indicator_trigger_call_patched__'
const collectorStorage = new AsyncLocalStorage<TriggerCollectorState>()

const captureTriggerCall = (context: any, args: unknown[]) => {
  const state = collectorStorage.getStore()
  if (!state) return
  captureIndicatorTriggerCall(state, context, args)
}

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
  if (contextPrototype[CONTEXT_CALL_PATCH_FLAG]) return

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
    const triggerById = isIndicatorTriggerCallId(id)

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
