import type { BlockConfig } from '@/blocks/types'
import { getOAuthProviderSubjectId } from '@/lib/oauth/oauth'

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

export const getBlockOAuthRequirements = (block: BlockConfig) => {
  const requiredOauthInputs = block.subBlocks.filter(isRequiredOAuthInput)

  const unconditionalProviders = new Set<string>()
  const conditionalProviders = new Set<string>()
  const oauthConditionFields = new Set<string>()

  for (const subBlock of requiredOauthInputs) {
    const providerId = getOAuthProviderSubjectId({
      provider: subBlock.provider,
      serviceId: subBlock.serviceId,
      requiredScopes: subBlock.requiredScopes,
    })
    if (!providerId) continue
    const conditionField = getConditionField(subBlock.condition)
    if (conditionField) {
      conditionalProviders.add(providerId)
      oauthConditionFields.add(conditionField)
    } else {
      unconditionalProviders.add(providerId)
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
    hasNonOAuthAlternative,
  }
}

const isProviderAvailable = (providerId: string, availability: ProviderAvailability) => {
  return Boolean(availability[providerId])
}

export const isBlockAvailable = (block: BlockConfig, availability: ProviderAvailability) => {
  const { unconditionalProviders, conditionalProviders, hasNonOAuthAlternative } =
    getBlockOAuthRequirements(block)

  if (unconditionalProviders.length > 0) {
    const allUnconditionalAvailable = unconditionalProviders.every((providerId) =>
      isProviderAvailable(providerId, availability)
    )
    if (!allUnconditionalAvailable) return false
  }

  if (conditionalProviders.length === 0) {
    return true
  }

  if (hasNonOAuthAlternative) {
    return true
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
