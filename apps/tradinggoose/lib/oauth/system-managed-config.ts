import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getOAuthCredentialFields,
  getOAuthProviderSubjectId,
  isSignInOAuthProviderId,
} from '@/lib/oauth/oauth'
import { resolveSystemIntegrationDefinitions } from '@/lib/system-integrations/resolver'

export interface SystemOAuthClientCredentials {
  clientId: string
  clientSecret: string
  fields: Record<string, string>
}

const oauthCredentialStorage = new AsyncLocalStorage<
  ReadonlyMap<string, SystemOAuthClientCredentials>
>()

const EMPTY_CREDENTIALS: SystemOAuthClientCredentials = {
  clientId: '',
  clientSecret: '',
  fields: {},
}

export async function loadSystemOAuthClientCredentials(providerIds: string[]) {
  const normalizedProviderIds = Array.from(
    new Set(providerIds.map((providerId) => providerId.trim()).filter(Boolean))
  )
  if (normalizedProviderIds.length === 0) {
    return {}
  }

  const subjectProviderIdsByRequestProviderId = new Map(
    normalizedProviderIds
      .filter((providerId) => !isSignInOAuthProviderId(providerId))
      .map((providerId) => [providerId, resolveSystemOAuthProviderSubjectId(providerId)])
  )
  const definitions = await resolveSystemIntegrationDefinitions(
    Array.from(new Set(subjectProviderIdsByRequestProviderId.values()))
  )
  const credentials: Record<string, SystemOAuthClientCredentials> = {}

  for (const providerId of normalizedProviderIds) {
    if (isSignInOAuthProviderId(providerId)) {
      continue
    }

    const subjectProviderId = subjectProviderIdsByRequestProviderId.get(providerId) ?? providerId
    const resolved = definitions[subjectProviderId]
    const systemCredentials = getSystemManagedOAuthClientCredentials(subjectProviderId, resolved)
    if (systemCredentials) {
      credentials[providerId] = systemCredentials
    }
  }

  return credentials
}

function getSystemManagedOAuthClientCredentials(
  providerId: string,
  resolved:
    | Awaited<ReturnType<typeof resolveSystemIntegrationDefinitions>>[string]
    | null
    | undefined
) {
  if (!resolved?.isEnabled) {
    return null
  }

  return buildOAuthClientCredentials(providerId, resolved.secrets)
}

function buildOAuthClientCredentials(providerId: string, values: Record<string, string>) {
  const credentialFields = getOAuthCredentialFields(providerId)
  const fields = Object.fromEntries(
    credentialFields.map((field) => [field.key, values[field.key]?.trim() ?? ''])
  )
  const requiredFields = credentialFields.filter((field) => field.required !== false)

  if (requiredFields.some((field) => !fields[field.key])) {
    return null
  }

  const clientIdField = credentialFields.find((field) => field.oauthProperty === 'clientId')
  const clientSecretField = credentialFields.find((field) => field.oauthProperty === 'clientSecret')

  return {
    clientId: clientIdField ? (fields[clientIdField.key] ?? '') : '',
    clientSecret: clientSecretField ? (fields[clientSecretField.key] ?? '') : '',
    fields,
  } satisfies SystemOAuthClientCredentials
}

function resolveSystemOAuthProviderSubjectId(providerId: string) {
  return getOAuthProviderSubjectId({ provider: providerId }) ?? providerId
}

export async function loadSystemOAuthClientCredentialsForProvider(providerId: string) {
  const normalizedProviderId = providerId.trim()
  if (!normalizedProviderId) {
    return null
  }

  const credentials = await loadSystemOAuthClientCredentials([normalizedProviderId])
  return credentials[normalizedProviderId] ?? null
}

export async function runWithSystemOAuthClientCredentials<T>(
  callback: () => Promise<T>,
  providerCredentials: Record<string, SystemOAuthClientCredentials>
) {
  return oauthCredentialStorage.run(new Map(Object.entries(providerCredentials)), callback)
}

export function getSystemOAuthClientCredentialsForRequest(
  providerId: string
): SystemOAuthClientCredentials {
  const store = oauthCredentialStorage.getStore()
  if (!store) {
    return EMPTY_CREDENTIALS
  }

  return store.get(providerId.trim()) ?? EMPTY_CREDENTIALS
}
