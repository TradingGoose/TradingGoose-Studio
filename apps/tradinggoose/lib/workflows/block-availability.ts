import { getOAuthProviderSubjectId } from '@/lib/oauth/oauth'
import type { BlockConfig } from '@/blocks/types'

export type ProviderAvailability = Record<string, boolean>

const NON_OAUTH_CREDENTIAL_HINTS = [
  'apiKey',
  'apiSecret',
  'accessToken',
  'refreshToken',
  'botToken',
  'authToken',
  'token',
  'secretKey',
  'secret',
]

const getConditionField = (
  condition: BlockConfig['subBlocks'][number]['condition']
): string | undefined => {
  if (!condition || typeof condition === 'function') return undefined
  return condition.field
}

const isRequiredOAuthInput = (block: BlockConfig['subBlocks'][number]) => {
  if (block.type !== 'oauth-input') return false
  if (block.required === true) return true
  return !block.condition && block.required !== false
}

const isNonOAuthCredentialInput = (block: BlockConfig['subBlocks'][number]) => {
  if (block.type === 'oauth-input') return false
  const id = block.id.toLowerCase()
  return NON_OAUTH_CREDENTIAL_HINTS.some((hint) => id.includes(hint.toLowerCase()))
}

const getOAuthProviderSubjectIds = (subBlock: BlockConfig['subBlocks'][number]) => {
  const serviceIds = Array.isArray(subBlock.serviceIds)
    ? subBlock.serviceIds.map((serviceId) => serviceId.trim()).filter(Boolean)
    : []

  if (serviceIds.length > 0) {
    return Array.from(
      new Set(
        serviceIds
          .map((serviceId) => getOAuthProviderSubjectId({ serviceId }))
          .filter((providerId): providerId is string => Boolean(providerId))
      )
    )
  }

  const providerId = getOAuthProviderSubjectId({
    provider: subBlock.provider,
    serviceId: subBlock.serviceId,
    requiredScopes: subBlock.requiredScopes,
  })

  return providerId ? [providerId] : []
}

export const getBlockOAuthRequirements = (block: BlockConfig) => {
  const requiredOauthInputs = block.subBlocks.filter(isRequiredOAuthInput)

  const unconditionalProviders = new Set<string>()
  const conditionalProviders = new Set<string>()
  const unconditionalProviderGroups: string[][] = []
  const conditionalProviderGroups: string[][] = []
  const oauthConditionFields = new Set<string>()

  for (const subBlock of requiredOauthInputs) {
    const providerIds = getOAuthProviderSubjectIds(subBlock)
    if (providerIds.length === 0) continue
    const conditionField = getConditionField(subBlock.condition)
    if (conditionField) {
      providerIds.forEach((providerId) => conditionalProviders.add(providerId))
      conditionalProviderGroups.push(providerIds)
      oauthConditionFields.add(conditionField)
    } else {
      providerIds.forEach((providerId) => unconditionalProviders.add(providerId))
      unconditionalProviderGroups.push(providerIds)
    }
  }

  let hasNonOAuthAlternative = false

  if (oauthConditionFields.size > 0) {
    for (const subBlock of block.subBlocks) {
      if (subBlock.required !== true) continue
      if (!isNonOAuthCredentialInput(subBlock)) continue
      const conditionField = getConditionField(subBlock.condition)
      if (conditionField && oauthConditionFields.has(conditionField)) {
        hasNonOAuthAlternative = true
        break
      }
    }
  }

  return {
    unconditionalProviders: Array.from(unconditionalProviders),
    conditionalProviders: Array.from(conditionalProviders),
    unconditionalProviderGroups,
    conditionalProviderGroups,
    hasNonOAuthAlternative,
  }
}

const isProviderAvailable = (providerId: string, availability: ProviderAvailability) => {
  return Boolean(availability[providerId])
}

export const isBlockAvailable = (block: BlockConfig, availability: ProviderAvailability) => {
  const {
    unconditionalProviders,
    conditionalProviders,
    unconditionalProviderGroups,
    conditionalProviderGroups,
    hasNonOAuthAlternative,
  } = getBlockOAuthRequirements(block)

  if (unconditionalProviderGroups.length > 0) {
    const allUnconditionalAvailable = unconditionalProviderGroups.every((providerIds) =>
      providerIds.some((providerId) => isProviderAvailable(providerId, availability))
    )
    if (!allUnconditionalAvailable) return false
  } else if (unconditionalProviders.length > 0) {
    const allUnconditionalAvailable = unconditionalProviders.every((providerId) =>
      isProviderAvailable(providerId, availability)
    )
    if (!allUnconditionalAvailable) return false
  }

  if (conditionalProviderGroups.length === 0 && conditionalProviders.length === 0) {
    return true
  }

  if (hasNonOAuthAlternative) {
    return true
  }

  if (conditionalProviderGroups.length > 0) {
    return conditionalProviderGroups.some((providerIds) =>
      providerIds.some((providerId) => isProviderAvailable(providerId, availability))
    )
  }

  return conditionalProviders.some((providerId) => isProviderAvailable(providerId, availability))
}

export const getProviderIdsForBlocks = (blocks: BlockConfig[]) => {
  const providers = new Set<string>()

  for (const block of blocks) {
    const { unconditionalProviders, conditionalProviders } = getBlockOAuthRequirements(block)
    unconditionalProviders.forEach((provider) => providers.add(provider))
    conditionalProviders.forEach((provider) => providers.add(provider))
  }

  return Array.from(providers)
}
