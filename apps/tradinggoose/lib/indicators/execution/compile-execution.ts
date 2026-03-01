import { resolveExecutionRuntimeConfig } from '@/lib/execution/runtime-config'
import { compileIndicator } from '@/lib/indicators/custom/compile'
import type { BarMs } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'

const INDICATOR_RUNTIME_CONFIG = resolveExecutionRuntimeConfig()

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
  listing,
  interval,
  intervalMs,
  executionTimeoutMs,
  userId,
}: {
  pineCode: string
  barsMs: BarMs[]
  inputsMap: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: string
  intervalMs?: number | null
  executionTimeoutMs: number
  userId?: string
}) => {
  const useE2B = INDICATOR_RUNTIME_CONFIG.useE2B

  return runWithExecutionTimeout(
    compileIndicator({
      pineCode,
      barsMs,
      inputsMap,
      listing,
      interval,
      intervalMs: intervalMs ?? null,
      useE2B,
      executionTimeoutMs,
      e2bTemplate: INDICATOR_RUNTIME_CONFIG.e2bTemplate,
      e2bKeepWarmMs: INDICATOR_RUNTIME_CONFIG.e2bKeepWarmMs,
      userId,
    }),
    executionTimeoutMs
  )
}
