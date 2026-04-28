import {
  coerceMarketProviderParamValue,
  getMarketProviderParamDefinitions,
  type MarketProviderParamDefinition,
} from '@/providers/market/providers'

const ENV_REF_PATTERN = /^\s*\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}\s*$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const trimProviderId = (providerId?: string) =>
  typeof providerId === 'string' ? providerId.trim() : ''

const isBlankCredentialValue = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

export const isFullEnvVarReference = (value: unknown): value is string =>
  typeof value === 'string' && ENV_REF_PATTERN.test(value)

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

export const sanitizeMarketProviderAuthRefs = (
  auth: unknown
): { apiKey?: string; apiSecret?: string } | undefined => {
  if (!isRecord(auth)) return undefined

  const nextAuth: { apiKey?: string; apiSecret?: string } = {}
  if (isFullEnvVarReference(auth.apiKey)) nextAuth.apiKey = auth.apiKey
  if (isFullEnvVarReference(auth.apiSecret)) nextAuth.apiSecret = auth.apiSecret

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
      if (isFullEnvVarReference(value)) {
        nextParams[key] = value
      }
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

export const validateMarketProviderCredentialRefs = (
  providerId: string | undefined,
  auth: unknown,
  providerParams?: unknown
): { valid: true } | { valid: false; fields: string[] } => {
  const fields: string[] = []

  if (isRecord(auth)) {
    for (const key of ['apiKey', 'apiSecret'] as const) {
      const value = auth[key]
      if (!isBlankCredentialValue(value) && !isFullEnvVarReference(value)) {
        fields.push(`auth.${key}`)
      }
    }
  }

  const params = isRecord(providerParams) ? providerParams : null
  if (params) {
    for (const key of ['apiKey', 'apiSecret'] as const) {
      if (!isBlankCredentialValue(params[key])) {
        fields.push(`providerParams.${key}`)
      }
    }
  }

  const trimmedProviderId = trimProviderId(providerId)
  if (trimmedProviderId && params) {
    const definitions = getMarketProviderParamDefinitions(trimmedProviderId, 'series')
    definitions.forEach((definition) => {
      if (definition.id === 'apiKey' || definition.id === 'apiSecret') return
      if (!isMarketProviderCredentialDefinition(definition)) return
      const value = params[definition.id]
      if (!isBlankCredentialValue(value) && !isFullEnvVarReference(value)) {
        fields.push(`providerParams.${definition.id}`)
      }
    })
  }

  return fields.length > 0 ? { valid: false, fields } : { valid: true }
}
