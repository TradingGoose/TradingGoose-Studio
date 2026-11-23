import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js'
import { getCanonicalScopesForProvider } from '@/lib/oauth/oauth'
import { ROBINHOOD_OAUTH_RESOURCE } from './robinhood-constants'

export async function registerRobinhoodOAuthClient(redirectUri: string) {
  const { hostname } = new URL(redirectUri)
  const clientMetadata = {
    application_type:
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
        ? 'native'
        : 'web',
    client_name: 'TradingGoose Studio',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  } satisfies Parameters<typeof registerClient>[1]['clientMetadata'] & {
    application_type: 'native' | 'web'
  }
  const registered = await registerClient(ROBINHOOD_OAUTH_RESOURCE, {
    metadata: {
      issuer: ROBINHOOD_OAUTH_RESOURCE,
      authorization_endpoint: 'https://robinhood.com/oauth',
      token_endpoint: 'https://api.robinhood.com/oauth2/token/',
      registration_endpoint: 'https://agent.robinhood.com/oauth/trading/register',
      response_types_supported: ['code'],
    },
    clientMetadata,
    scope: getCanonicalScopesForProvider('robinhood').join(' '),
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

  return clientId
}
