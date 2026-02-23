import { Indicator, PineTS } from 'pinets'
import {
  bootstrapIndicatorTriggerBridge,
  runWithIndicatorTriggerCollector,
} from '@/lib/indicators/trigger-bridge'
import type { BarMs } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'

type RunPineTSArgs = {
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: string
  code: string | Function
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

export const runPineTS = async ({
  barsMs,
  inputsMap = {},
  listing,
  interval,
  code,
}: RunPineTSArgs) => {
  bootstrapIndicatorTriggerBridge(globalThis as unknown as Record<string, unknown>)
  const pine = new PineTS(barsMs, toPineSymbol(listing), interval)
  await pine.ready()
  const { result: context, events, warnings } = await runWithIndicatorTriggerCollector(() =>
    pine.run(new Indicator(code, inputsMap))
  )
  return {
    context,
    transpiledCode: pine.transpiledCode,
    triggerSignals: events,
    triggerWarnings: warnings,
  }
}
