import { compileIndicator } from '@/lib/indicators/custom/compile'
import type { BarMs } from '@/lib/indicators/types'

const runWithExecutionTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId)
        reject(new Error('Execution timed out'))
      }, timeoutMs)
    }),
  ])

export const executeCompiledIndicator = async ({
  pineCode,
  barsMs,
  inputsMap,
  listingKey,
  interval,
  intervalMs,
  useE2B,
  e2bTemplate,
  e2bKeepWarmMs,
  executionTimeoutMs,
}: {
  pineCode: string
  barsMs: BarMs[]
  inputsMap: Record<string, unknown>
  listingKey?: string
  interval?: string
  intervalMs?: number | null
  useE2B: boolean
  e2bTemplate?: string
  e2bKeepWarmMs?: number
  executionTimeoutMs: number
}) =>
  runWithExecutionTimeout(
    compileIndicator({
      pineCode,
      barsMs,
      inputsMap,
      listingKey,
      interval,
      intervalMs: intervalMs ?? null,
      useE2B,
      executionTimeoutMs,
      e2bTemplate,
      e2bKeepWarmMs,
    }),
    executionTimeoutMs
  )
