import { AsyncLocalStorage } from 'node:async_hooks'
import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js'
import { db } from '@tradinggoose/db'
import { systemIntegrationDefinition, systemIntegrationSecret } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  getCanonicalScopesForProvider,
  getOAuthCredentialFields,
  getOAuthProviderSubjectId,
  isSignInOAuthProviderId,
} from '@/lib/oauth/oauth'
import { buildSystemIntegrationBundleDefinitionId } from '@/lib/system-integrations/catalog'
import { resolveSystemIntegrationDefinitions } from '@/lib/system-integrations/resolver'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

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

export async function ensureRobinhoodOAuthClient(redirectUri: string): Promise<string> {
  const providerId = 'robinhood'
  const resource = 'https://agent.robinhood.com/mcp/trading'
  const definitionId = buildSystemIntegrationBundleDefinitionId(providerId)

  return db.transaction(async (tx) => {
    await tx
      .insert(systemIntegrationDefinition)
      .values({ id: definitionId, parentId: null, name: 'Robinhood', isEnabled: null })
      .onConflictDoNothing()

    // Serialize first connections across servers so every callback uses the same client ID.
    await tx
      .select({ id: systemIntegrationDefinition.id })
      .from(systemIntegrationDefinition)
      .where(eq(systemIntegrationDefinition.id, definitionId))
      .for('update')

    const existing = await tx
      .select({ key: systemIntegrationSecret.key, value: systemIntegrationSecret.value })
      .from(systemIntegrationSecret)
      .where(eq(systemIntegrationSecret.definitionId, definitionId))
    const stored = new Map<string, string>()
    for (const { key, value } of existing) {
      const { decrypted } = await decryptSecret(value)
      stored.set(key, decrypted.trim())
    }
    const clientId = stored.get('client_id')
    if (clientId) {
      if (stored.get('redirect_uri') !== redirectUri) {
        throw new Error('Robinhood OAuth client is registered for a different redirect URI')
      }
      return clientId
    }

    const registered = await registerClient(resource, {
      metadata: {
        issuer: resource,
        authorization_endpoint: 'https://robinhood.com/oauth',
        token_endpoint: 'https://api.robinhood.com/oauth2/token/',
        registration_endpoint: 'https://agent.robinhood.com/oauth/trading/register',
        response_types_supported: ['code'],
      },
      clientMetadata: {
        client_name: 'TradingGoose Studio',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      scope: getCanonicalScopesForProvider(providerId).join(' '),
      fetchFn: (url, init) =>
        fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }),
    })
    const registeredClientId = registered.client_id.trim()
    if (
      !registeredClientId ||
      registered.token_endpoint_auth_method !== 'none' ||
      !registered.redirect_uris.includes(redirectUri)
    ) {
      throw new Error('Robinhood returned an incompatible OAuth client registration')
    }

    for (const [key, value] of [
      ['client_id', registeredClientId],
      ['redirect_uri', redirectUri],
    ] as const) {
      const { encrypted } = await encryptSecret(value)
      await tx
        .insert(systemIntegrationSecret)
        .values({
          id: `system-integration-secret:${definitionId}:${key}`,
          definitionId,
          key,
          value: encrypted,
        })
        .onConflictDoUpdate({
          target: [systemIntegrationSecret.definitionId, systemIntegrationSecret.key],
          set: { value: encrypted, updatedAt: new Date() },
        })
    }

    return registeredClientId
  })
}
