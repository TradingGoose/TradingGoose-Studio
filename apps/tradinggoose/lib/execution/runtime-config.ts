import { env, isTruthy } from '@/lib/env'

const DEFAULT_E2B_KEEP_WARM_MS = 5 * 60 * 1000

const coercePositiveInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

export const resolveExecutionRuntimeConfig = () => {
  const useE2B = isTruthy(env.E2B_ENABLED) && Boolean(process.env.E2B_API_KEY)
  const e2bTemplate = env.E2B_INDICATOR_TEMPLATE_ID
  const configuredKeepWarmMs = coercePositiveInt(
    env.E2B_INDICATOR_KEEP_WARM_MS ?? env.E2B_KEEP_WARM_MS
  )
  const e2bKeepWarmMs = useE2B ? (configuredKeepWarmMs ?? DEFAULT_E2B_KEEP_WARM_MS) : undefined

  return {
    useE2B,
    e2bTemplate,
    e2bKeepWarmMs,
  }
}
