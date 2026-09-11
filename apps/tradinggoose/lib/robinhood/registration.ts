import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js'
import { db } from '@tradinggoose/db'
import { systemIntegrationDefinition, systemIntegrationSecret } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getCanonicalScopesForProvider } from '@/lib/oauth/oauth'
import {
  ROBINHOOD_AUTHORIZATION_URL,
  ROBINHOOD_MCP_URL,
  ROBINHOOD_PROVIDER_ID,
  ROBINHOOD_REGISTRATION_URL,
  ROBINHOOD_TOKEN_URL,
} from '@/lib/robinhood/constants'
import { buildSystemIntegrationBundleDefinitionId } from '@/lib/system-integrations/catalog'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

export async function ensureRobinhoodOAuthClient(redirectUri: string): Promise<string> {
  const definitionId = buildSystemIntegrationBundleDefinitionId(ROBINHOOD_PROVIDER_ID)

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

    const [existing] = await tx
      .select({ value: systemIntegrationSecret.value })
      .from(systemIntegrationSecret)
      .where(
        and(
          eq(systemIntegrationSecret.definitionId, definitionId),
          eq(systemIntegrationSecret.key, 'client_id')
        )
      )
      .limit(1)
    if (existing) {
      const { decrypted } = await decryptSecret(existing.value)
      if (decrypted.trim()) return decrypted.trim()
    }

    const registered = await registerClient(ROBINHOOD_MCP_URL, {
      metadata: {
        issuer: ROBINHOOD_MCP_URL,
        authorization_endpoint: ROBINHOOD_AUTHORIZATION_URL,
        token_endpoint: ROBINHOOD_TOKEN_URL,
        registration_endpoint: ROBINHOOD_REGISTRATION_URL,
        response_types_supported: ['code'],
      },
      clientMetadata: {
        client_name: 'TradingGoose Studio',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      scope: getCanonicalScopesForProvider(ROBINHOOD_PROVIDER_ID).join(' '),
      fetchFn: (url, init) =>
        fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }),
    })
    const clientId = registered.client_id.trim()
    if (
      !clientId ||
      registered.token_endpoint_auth_method !== 'none' ||
      !registered.redirect_uris.includes(redirectUri)
    ) {
      throw new Error('Robinhood returned an incompatible OAuth client registration')
    }

    const { encrypted } = await encryptSecret(clientId)
    await tx
      .insert(systemIntegrationSecret)
      .values({
        id: `system-integration-secret:${definitionId}:client_id`,
        definitionId,
        key: 'client_id',
        value: encrypted,
      })
      .onConflictDoUpdate({
        target: [systemIntegrationSecret.definitionId, systemIntegrationSecret.key],
        set: { value: encrypted, updatedAt: new Date() },
      })

    return clientId
  })
}
