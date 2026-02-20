import { Indicator, PineTS } from 'pinets'
import {
  bootstrapIndicatorTriggerBridge,
  runWithIndicatorTriggerCollector,
} from '@/lib/indicators/trigger-bridge'
import type { BarMs } from '@/lib/indicators/types'

type RunPineTSArgs = {
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listingKey?: string
  interval?: string
  code: string | Function
}

export const runPineTS = async ({
  barsMs,
  inputsMap = {},
  listingKey,
  interval,
  code,
}: RunPineTSArgs) => {
  bootstrapIndicatorTriggerBridge(globalThis as unknown as Record<string, unknown>)
  const pine = new PineTS(barsMs, listingKey, interval)
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
