import { getOAuthProviderSubjectId } from '@/lib/oauth/oauth'
import type { BlockConfig } from '@/blocks/types'

export type ProviderAvailability = Record<string, boolean>

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

const getBlockOAuthProviderGroups = (block: BlockConfig) =>
  block.subBlocks
    .filter((subBlock) => subBlock.type === 'oauth-input' && !subBlock.condition)
    .map(getOAuthProviderSubjectIds)
    .filter((providerIds) => providerIds.length > 0)

export const isBlockAvailable = (block: BlockConfig, availability: ProviderAvailability) => {
  return getBlockOAuthProviderGroups(block).every((providerIds) =>
    providerIds.some((providerId) => availability[providerId] === true)
  )
}

export const getProviderIdsForBlocks = (blocks: BlockConfig[]) => {
  const providers = new Set<string>()

  for (const block of blocks) {
    for (const providerIds of getBlockOAuthProviderGroups(block)) {
      providerIds.forEach((providerId) => providers.add(providerId))
    }
  }

  return Array.from(providers)
}
