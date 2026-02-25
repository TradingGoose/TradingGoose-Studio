import { createContext, Script } from 'vm'
import { runPineTS } from '@/lib/indicators/run-pinets'
import { createIndicatorTriggerSentinel } from '@/lib/indicators/trigger-bridge'
import type { BarMs } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'

type PineVmFn = (...args: unknown[]) => unknown

const createLocalVmIndicatorFunction = (code: string): PineVmFn => {
  const vmContext = createContext({
    Math,
    Date,
    trigger: createIndicatorTriggerSentinel(),
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  })
  const script = new Script(`(${code})`, { filename: 'indicator-code.js' })
  const fn = script.runInContext(vmContext)
  if (typeof fn !== 'function') throw new Error('Expected a function expression')
  return fn as PineVmFn
}

export const executeIndicatorInLocalVm = async ({
  barsMs,
  inputsMap,
  listing,
  interval,
  code,
  codeFormat = 'pinets',
}: {
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: string
  code: string | PineVmFn
  codeFormat?: 'pinets' | 'functionExpression'
}) => {
  const runtimeCode =
    codeFormat === 'functionExpression' && typeof code === 'string'
      ? createLocalVmIndicatorFunction(code)
      : code

  return runPineTS({
    barsMs,
    inputsMap,
    listing,
    interval,
    code: runtimeCode,
  })
}
