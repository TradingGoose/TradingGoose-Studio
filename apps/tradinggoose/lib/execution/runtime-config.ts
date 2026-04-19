import { resolveE2BServiceConfig } from '@/lib/system-services/runtime'

const DEFAULT_E2B_KEEP_WARM_TARGET_MS = 5 * 60 * 1000

export const resolveExecutionRuntimeConfig = async () => {
  const e2bConfig = await resolveE2BServiceConfig()
  const useE2B = e2bConfig.enabled && Boolean(e2bConfig.apiKey)
  const e2bTemplate = e2bConfig.templateId
  const configuredKeepWarmMs = e2bConfig.keepWarmTargetMs
  const e2bKeepWarmMs = useE2B
    ? (configuredKeepWarmMs ?? DEFAULT_E2B_KEEP_WARM_TARGET_MS)
    : undefined

  return {
    useE2B,
    e2bTemplate,
    e2bKeepWarmMs,
    e2bApiKey: e2bConfig.apiKey,
  }
}
