'use client'

import { Context, Indicator, PineTS } from 'pinets'
import { normalizeContext } from '@/lib/indicators/normalize-context'
import { buildIndexMaps } from '@/lib/indicators/series-data'
import {
  captureIndicatorTriggerCall,
  createIndicatorTriggerSentinel,
  isIndicatorTriggerCallId,
  TG_INDICATOR_TRIGGER_SENTINEL,
  type TriggerCollectorState,
} from '@/lib/indicators/trigger-capture'
import { detectTriggerUsage } from '@/lib/indicators/trigger-detection'
import type {
  BarMs,
  InputMetaMap,
  NormalizedPineOutput,
  NormalizedPineSignal,
  PineWarning,
} from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'

let browserTriggerShimLock: Promise<void> = Promise.resolve()
let activeTriggerCollector: TriggerCollectorState | null = null

const CONTEXT_CALL_PATCH_FLAG = '__tg_browser_indicator_trigger_call_patched__'

const captureTriggerCall = (context: any, args: unknown[]) => {
  const state = activeTriggerCollector
  if (!state) return
  captureIndicatorTriggerCall(state, context, args)
}

const patchBrowserContextCallForTriggerCapture = () => {
  const contextPrototype = Context.prototype as unknown as Record<string, unknown>
  if (contextPrototype[CONTEXT_CALL_PATCH_FLAG]) return

  const originalCall = contextPrototype.call as
    | ((this: any, fn: (...args: unknown[]) => unknown, id: string, ...args: unknown[]) => unknown)
    | undefined
  if (typeof originalCall !== 'function') {
    throw new Error('PineTS Context.call is unavailable for trigger bridge patching.')
  }

  contextPrototype.call = function patchedBrowserIndicatorContextCall(
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

const runWithBrowserTriggerCollector = async <T>(runner: () => Promise<T> | T) => {
  const previousLock = browserTriggerShimLock
  let releaseLock: () => void = () => {}
  browserTriggerShimLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  await previousLock

  const previousTrigger = (globalThis as { trigger?: (() => void) | undefined }).trigger
  const previousCollector = activeTriggerCollector
  const collector: TriggerCollectorState = { events: [], warnings: [] }
  ;(globalThis as { trigger?: () => void }).trigger = createIndicatorTriggerSentinel()
  patchBrowserContextCallForTriggerCapture()
  activeTriggerCollector = collector

  try {
    const result = await runner()
    return {
      result,
      events: [...collector.events],
      warnings: [...collector.warnings],
    }
  } finally {
    activeTriggerCollector = previousCollector
    if (previousTrigger === undefined) {
      ;(globalThis as { trigger?: () => void }).trigger = undefined
    } else {
      ;(globalThis as { trigger?: () => void }).trigger = previousTrigger
    }
    releaseLock()
  }
}

const toPineSymbol = (listing?: ListingIdentity | null) => {
  if (!listing) return undefined
  if (listing.listing_type === 'default') {
    const listingId = listing.listing_id?.trim()
    return listingId || undefined
  }
  const baseId = listing.base_id?.trim()
  const quoteId = listing.quote_id?.trim()
  if (!baseId || !quoteId) return undefined
  return `${baseId}:${quoteId}`
}

const applyInputVisibilityToggles = ({
  output,
  inputMeta,
  inputsMap,
}: {
  output: NormalizedPineOutput
  inputMeta?: InputMetaMap | null
  inputsMap: Record<string, unknown>
}) => {
  if (!inputMeta) return

  Object.entries(inputMeta).forEach(([title, inputDef]) => {
    if (inputDef.type !== 'bool') return
    const inputValue = inputsMap[title]
    if (inputValue !== false && inputValue !== 0) return
    const match = title.match(/^show\s+(.+?)(?:\s+line)?$/i)
    if (!match) return
    const plotName = match[1]!.toLowerCase()
    output.series.forEach((series) => {
      if (series.plot.title.toLowerCase().includes(plotName)) {
        series.points = series.points.map((point) => ({ ...point, value: null }))
      }
    })
  })
}

export const executeBrowserPineIndicator = async ({
  barsMs,
  pineCode,
  inputsMap = {},
  inputMeta,
  listing,
  symbol,
  interval,
}: {
  barsMs: BarMs[]
  pineCode: string
  inputsMap?: Record<string, unknown>
  inputMeta?: InputMetaMap | null
  listing?: ListingIdentity | null
  symbol?: string
  interval?: string
}): Promise<{ output: NormalizedPineOutput; warnings: PineWarning[] }> => {
  const pine = new PineTS(barsMs, symbol ?? toPineSymbol(listing), interval)
  await pine.ready()

  let context: any
  let triggerSignals: NormalizedPineSignal[] = []
  let triggerWarnings: PineWarning[] = []
  if (detectTriggerUsage(pineCode)) {
    const result = await runWithBrowserTriggerCollector(() =>
      pine.run(new Indicator(pineCode, inputsMap))
    )
    context = result.result
    triggerSignals = result.events
    triggerWarnings = result.warnings
  } else {
    context = await pine.run(new Indicator(pineCode, inputsMap))
  }

  const { output, warnings } = normalizeContext({
    context,
    ...buildIndexMaps(barsMs),
    triggerSignals,
  })
  applyInputVisibilityToggles({ output, inputMeta, inputsMap })

  return { output, warnings: [...warnings, ...triggerWarnings] }
}
