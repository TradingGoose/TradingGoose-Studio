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
  const subjects = new Map<string, string>()
  for (const id of providerIds) {
    const provider = id.trim()
    if (isSignInOAuthProviderId(provider)) continue
    const subject = getOAuthProviderSubjectId({ provider })
    if (subject) subjects.set(provider, subject)
  }
  const definitions = await resolveSystemIntegrationDefinitions([...subjects.values()])
  const credentials: Record<string, SystemOAuthClientCredentials> = {}
  for (const [provider, subject] of subjects) {
    const resolved = definitions[subject]
    if (!resolved?.isEnabled) continue
    const systemCredentials = buildOAuthClientCredentials(subject, resolved.secrets)
    if (systemCredentials) credentials[provider] = systemCredentials
  }
  return credentials
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

export async function loadSystemOAuthClientCredentialsForProvider(providerId: string) {
  const credentials = await loadSystemOAuthClientCredentials([providerId])
  return credentials[providerId.trim()] ?? null
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
  return oauthCredentialStorage.getStore()?.get(providerId.trim()) ?? EMPTY_CREDENTIALS
}

export function setSystemOAuthClientIdForRequest(providerId: string, clientId: string) {
  const credentials = oauthCredentialStorage.getStore()?.get(providerId.trim())
  const normalizedClientId = clientId.trim()
  if (!credentials || !normalizedClientId) {
    throw new Error('OAuth client registration context is missing')
  }

  credentials.clientId = normalizedClientId
}
