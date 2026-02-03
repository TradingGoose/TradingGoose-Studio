import { Indicator, PineTS } from 'pinets'
import type { BarMs } from '@/lib/new_indicators/types'

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
  const pine = new PineTS(barsMs, listingKey, interval)
  await pine.ready()
  const context = await pine.run(new Indicator(code, inputsMap))
  return { context, transpiledCode: pine.transpiledCode }
}

