import { createContext, Script } from 'vm'
import { runPineTS } from '@/lib/indicators/run-pinets'
import type { BarMs } from '@/lib/indicators/types'

type PineVmFn = (...args: unknown[]) => unknown

const createLocalVmIndicatorFunction = (code: string): PineVmFn => {
  const vmContext = createContext({
    Math,
    Date,
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
  listingKey,
  interval,
  code,
  codeFormat = 'pinets',
}: {
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listingKey?: string
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
    listingKey,
    interval,
    code: runtimeCode,
  })
}
