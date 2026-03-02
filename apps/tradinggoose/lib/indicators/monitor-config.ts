import { z } from 'zod'
import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import { encryptSecret } from '@/lib/utils'
import {
  coerceMarketProviderParamValue,
  getMarketLiveCapabilities,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'

export const INDICATOR_MONITOR_TRIGGER_ID = 'indicator_trigger' as const

const MonitorAuthInputSchema = z
  .object({
    secrets: z.record(z.string()).optional(),
  })
  .optional()

export const IndicatorMonitorMutationSchema = z.object({
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
  blockId: z.string().min(1),
  providerId: z.string().min(1),
  interval: z.string().min(1),
  indicatorId: z.string().min(1),
  listing: z.any(),
  isActive: z.boolean().optional(),
  auth: MonitorAuthInputSchema,
  providerParams: z.record(z.unknown()).optional(),
})

export type IndicatorMonitorAuthStored = {
  encryptedSecrets?: Record<string, string>
  secretVersion?: 1
}

export type IndicatorMonitorAuthPublic = {
  hasEncryptedSecrets?: boolean
  encryptedSecretFieldIds?: string[]
  secretReferences?: Record<string, string>
}

export type IndicatorMonitorProviderConfig = {
  triggerId: typeof INDICATOR_MONITOR_TRIGGER_ID
  version: 1
  monitor: {
    triggerBlockId: string
    providerId: string
    interval: string
    listing: ListingIdentity
    indicatorId: string
    auth?: IndicatorMonitorAuthStored
    providerParams?: Record<string, unknown>
  }
}

const getRequiredLiveSecretParamIds = (providerId: string): string[] =>
  getMarketProviderParamDefinitions(providerId, 'live')
    .filter((definition) => definition.password && definition.required)
    .map((definition) => definition.id)

const normalizeProviderParams = (
  providerId: string,
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!raw || Object.keys(raw).length === 0) return undefined

  const definitions = getMarketProviderParamDefinitions(providerId, 'live')
  const nonSecretDefinitions = definitions.filter((definition) => !definition.password)
  const definitionMap = new Map(
    nonSecretDefinitions.map((definition) => [definition.id, definition])
  )
  const normalized: Record<string, unknown> = {}

  Object.entries(raw).forEach(([key, value]) => {
    const definition = definitionMap.get(key)
    if (!definition) return
    const coerced = coerceMarketProviderParamValue(definition, value)
    if (coerced === undefined) return
    normalized[key] = coerced
  })

  nonSecretDefinitions.forEach((definition) => {
    if (definition.required && normalized[definition.id] === undefined) {
      throw new Error(`Missing required provider param: ${definition.id}`)
    }
  })

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

const normalizeAuthPublic = (
  auth?: IndicatorMonitorAuthStored
): IndicatorMonitorAuthPublic | undefined => {
  if (!auth) return undefined
  const encryptedSecretFieldIds = Object.keys(auth.encryptedSecrets ?? {})
  if (encryptedSecretFieldIds.length === 0) return undefined
  return {
    hasEncryptedSecrets: true,
    encryptedSecretFieldIds,
  }
}

export const toPublicIndicatorMonitorProviderConfig = (
  config: IndicatorMonitorProviderConfig
): IndicatorMonitorProviderConfig & {
  monitor: Omit<IndicatorMonitorProviderConfig['monitor'], 'auth'> & {
    auth?: IndicatorMonitorAuthPublic
  }
} => {
  const { monitor, ...rest } = config
  return {
    ...rest,
    monitor: {
      ...monitor,
      auth: normalizeAuthPublic(monitor.auth),
    },
  }
}

type NormalizeMonitorConfigInput = {
  triggerBlockId: string
  providerId: string
  interval: string
  listingInput: unknown
  indicatorId: string
  authInput?: {
    secrets?: Record<string, string>
  }
  providerParams?: Record<string, unknown>
  previousAuth?: IndicatorMonitorAuthStored
}

export const normalizeIndicatorMonitorConfig = async (
  input: NormalizeMonitorConfigInput
): Promise<IndicatorMonitorProviderConfig> => {
  const liveCapabilities = getMarketLiveCapabilities(input.providerId)
  if (!liveCapabilities?.supportsStreaming) {
    throw new Error(`Provider ${input.providerId} does not support live streaming.`)
  }

  const intervalOptions = getMarketSeriesCapabilities(input.providerId)?.intervals ?? []
  if (!intervalOptions.includes(input.interval as any)) {
    throw new Error(`Interval ${input.interval} is not supported for provider ${input.providerId}.`)
  }

  const listing = toListingValueObject(input.listingInput as ListingInputValue)
  if (!listing) {
    throw new Error('Invalid listing value.')
  }

  const requiredSecretParamIds = getRequiredLiveSecretParamIds(input.providerId)
  const incomingSecretValues = input.authInput?.secrets ?? {}
  const replacingAuth = input.authInput !== undefined
  const encryptedSecrets: Record<string, string> = replacingAuth
    ? {}
    : { ...(input.previousAuth?.encryptedSecrets ?? {}) }

  for (const [fieldId, secretValue] of Object.entries(incomingSecretValues)) {
    const trimmed = secretValue?.trim()
    if (!trimmed) continue
    const encrypted = await encryptSecret(trimmed)
    encryptedSecrets[fieldId] = encrypted.encrypted
  }

  if (!input.previousAuth) {
    const missingRequiredSecrets = requiredSecretParamIds.filter(
      (fieldId) => !encryptedSecrets[fieldId]
    )
    if (missingRequiredSecrets.length > 0) {
      throw new Error(
        `Missing required auth secret values for provider fields: ${missingRequiredSecrets.join(', ')}`
      )
    }
  }

  const providerParams = normalizeProviderParams(input.providerId, input.providerParams)
  const auth: IndicatorMonitorAuthStored | undefined =
    Object.keys(encryptedSecrets).length > 0
      ? {
          encryptedSecrets,
          secretVersion: 1,
        }
      : undefined

  return {
    triggerId: INDICATOR_MONITOR_TRIGGER_ID,
    version: 1,
    monitor: {
      triggerBlockId: input.triggerBlockId,
      providerId: input.providerId,
      interval: input.interval,
      listing,
      indicatorId: input.indicatorId,
      ...(auth ? { auth } : {}),
      ...(providerParams ? { providerParams } : {}),
    },
  }
}
