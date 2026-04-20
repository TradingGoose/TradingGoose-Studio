import {
  getBaseProviderForService,
  getOAuthCredentialFields,
  OAUTH_PROVIDERS,
} from '@/lib/oauth/oauth'

export interface SystemIntegrationCatalogDefinitionSeed {
  id: string
  parentId: string | null
  name: string
  isEnabled: boolean | null
}

export interface SystemIntegrationCatalogSecretSeed {
  id: string
  definitionId: string
  key: string
  required: boolean
  value: string
}

export interface SystemIntegrationCatalogSeedSnapshot {
  definitions: SystemIntegrationCatalogDefinitionSeed[]
  secrets: SystemIntegrationCatalogSecretSeed[]
}

export function buildSystemIntegrationBundleDefinitionId(providerId: string) {
  return `bundle:${providerId.trim()}`
}

export function getSystemIntegrationCatalogDefinitionIds() {
  return new Set(getSystemIntegrationCatalogSeedSnapshot().definitions.map((definition) => definition.id))
}

export function getSystemIntegrationCatalogCredentialFields(definitionId: string) {
  const providerId = definitionId.startsWith('bundle:')
    ? definitionId.slice('bundle:'.length)
    : getBaseProviderForService(definitionId)

  return getOAuthCredentialFields(providerId)
}

export function getSystemIntegrationCatalogSeedSnapshot(): SystemIntegrationCatalogSeedSnapshot {
  const definitions: SystemIntegrationCatalogDefinitionSeed[] = []
  const secrets: SystemIntegrationCatalogSecretSeed[] = []

  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    const bundleDefinitionId = buildSystemIntegrationBundleDefinitionId(provider.id)

    definitions.push({
      id: bundleDefinitionId,
      parentId: null,
      name: provider.name,
      isEnabled: null,
    })

    secrets.push(
      ...getOAuthCredentialFields(provider.id).map((field) =>
        buildSecretSeed(bundleDefinitionId, field)
      )
    )

    for (const service of Object.values(provider.services)) {
      definitions.push({
        id: service.providerId,
        parentId: bundleDefinitionId,
        name: service.name,
        isEnabled: true,
      })
    }
  }

  return {
    definitions,
    secrets,
  }
}

function buildSecretSeed(
  definitionId: string,
  field: ReturnType<typeof getOAuthCredentialFields>[number]
): SystemIntegrationCatalogSecretSeed {
  return {
    id: buildSeedId('secret', definitionId, field.key),
    definitionId,
    key: field.key,
    required: field.required !== false,
    value: '',
  }
}

function buildSeedId(kind: 'secret', first: string, second?: string) {
  return `system-integration-${kind}:${first}:${second}`
}
