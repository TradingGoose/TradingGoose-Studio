import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getCredentialProviderForService,
  getOAuthCredentialFields,
} from '@/lib/oauth/oauth'
import { env } from '@/lib/env'
import { resolveSystemIntegrationDefinitions } from '@/lib/system-integrations/resolver'

export interface SystemOAuthClientCredentials {
  clientId: string
  clientSecret: string
  fields: Record<string, string>
}

const oauthCredentialStorage = new AsyncLocalStorage<ReadonlyMap<string, SystemOAuthClientCredentials>>()

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

  const definitions = await resolveSystemIntegrationDefinitions(normalizedProviderIds)
  const credentials: Record<string, SystemOAuthClientCredentials> = {}

  for (const providerId of normalizedProviderIds) {
    const resolved = definitions[providerId]
    const systemCredentials = getSystemManagedOAuthClientCredentials(providerId, resolved)
    if (systemCredentials) {
      credentials[providerId] = systemCredentials
      continue
    }

    if (resolved) {
      continue
    }
    const envCredentials = getEnvironmentOAuthClientCredentials(providerId)
    if (envCredentials) {
      credentials[providerId] = envCredentials
    }
  }

  return credentials
}

function getSystemManagedOAuthClientCredentials(
  providerId: string,
  resolved: Awaited<ReturnType<typeof resolveSystemIntegrationDefinitions>>[string] | null | undefined
) {
  if (!resolved?.isEnabled) {
    return null
  }

  return buildOAuthClientCredentials(providerId, resolved.secrets)
}

function getEnvironmentOAuthClientCredentials(providerId: string) {
  const credentialProvider = getCredentialProviderForService(providerId)
  const envPrefix = normalizeEnvKeySegment(credentialProvider)
  const envValues = Object.fromEntries(
    getOAuthCredentialFields(providerId).map((field) => [
      field.key,
      readEnvironmentCredentialValue(envPrefix, field.key),
    ])
  )

  return buildOAuthClientCredentials(providerId, envValues)
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
    clientId: clientIdField ? fields[clientIdField.key] ?? '' : '',
    clientSecret: clientSecretField ? fields[clientSecretField.key] ?? '' : '',
    fields,
  } satisfies SystemOAuthClientCredentials
}

function normalizeEnvKeySegment(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

function readEnvironmentCredentialValue(prefix: string, key: string) {
  const envKey = `${prefix}_${normalizeEnvKeySegment(key)}`
  const value = (env as Record<string, unknown>)[envKey]
  return typeof value === 'string' ? value.trim() : ''
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
