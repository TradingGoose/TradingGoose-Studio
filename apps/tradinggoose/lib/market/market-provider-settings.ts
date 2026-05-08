import {
  coerceMarketProviderParamValue,
  getMarketProviderParamDefinitions,
  type MarketProviderParamDefinition,
} from '@/providers/market/providers'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const trimProviderId = (providerId?: string) =>
  typeof providerId === 'string' ? providerId.trim() : ''

const readCredentialString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  return value.trim() ? value : undefined
}

export const isMarketProviderCredentialDefinition = (definition: MarketProviderParamDefinition) =>
  definition.password === true || definition.id === 'apiKey' || definition.id === 'apiSecret'

export const resolveMarketProviderSettingsDefinitions = (
  providerId?: string
): MarketProviderParamDefinition[] => {
  const trimmedProviderId = trimProviderId(providerId)
  if (!trimmedProviderId) return []

  return getMarketProviderParamDefinitions(trimmedProviderId, 'series').filter((definition) => {
    if (definition.visibility === 'hidden' || definition.visibility === 'llm-only') return false
    return definition.required === true || isMarketProviderCredentialDefinition(definition)
  })
}

export const sanitizeMarketProviderAuth = (
  auth: unknown
): { apiKey?: string; apiSecret?: string } | undefined => {
  if (!isRecord(auth)) return undefined

  const nextAuth: { apiKey?: string; apiSecret?: string } = {}
  const apiKey = readCredentialString(auth.apiKey)
  const apiSecret = readCredentialString(auth.apiSecret)

  if (apiKey) nextAuth.apiKey = apiKey
  if (apiSecret) nextAuth.apiSecret = apiSecret

  return Object.keys(nextAuth).length > 0 ? nextAuth : undefined
}

export const sanitizeMarketProviderParamsForWidget = (
  providerId: string | undefined,
  providerParams: unknown
): Record<string, unknown> | undefined => {
  if (!isRecord(providerParams)) return undefined

  const trimmedProviderId = trimProviderId(providerId)
  const definitions = trimmedProviderId
    ? getMarketProviderParamDefinitions(trimmedProviderId, 'series')
    : []
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const nextParams: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(providerParams)) {
    if (key === 'apiKey' || key === 'apiSecret') continue
    if (typeof value === 'string' && value.trim() === '') continue

    const definition = definitionsById.get(key)
    if (!definition) {
      nextParams[key] = value
      continue
    }

    if (isMarketProviderCredentialDefinition(definition)) {
      const credentialValue = readCredentialString(value)
      if (credentialValue) nextParams[key] = credentialValue
      continue
    }

    try {
      const coerced = coerceMarketProviderParamValue(definition, value)
      if (coerced !== undefined && coerced !== null && coerced !== '') {
        nextParams[key] = coerced
      }
    } catch {
      // Invalid typed provider params should not be persisted into widget params.
    }
  }

  return Object.keys(nextParams).length > 0 ? nextParams : undefined
}
