import { resolveExecutionRuntimeConfig } from '@/lib/execution/runtime-config'
import { compileIndicator } from '@/lib/indicators/custom/compile'
import type { BarMs } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'

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
  const runtimeConfig = await resolveExecutionRuntimeConfig()
  const useE2B = runtimeConfig.useE2B

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
      e2bTemplate: runtimeConfig.e2bTemplate ?? undefined,
      e2bKeepWarmMs: runtimeConfig.e2bKeepWarmMs,
      userId,
    }),
    executionTimeoutMs
  )
}
