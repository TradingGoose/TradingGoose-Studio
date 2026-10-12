import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js'
import { db, verification } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { getCanonicalScopesForProvider } from '@/lib/oauth/oauth'
import { ROBINHOOD_OAUTH_RESOURCE } from './robinhood-constants'

const ROBINHOOD_CLIENT_ID_STATE_KEY = 'robinhoodClientId'

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

export function addRobinhoodOAuthClientToState(value: string, clientId: string) {
  const state = JSON.parse(value)
  const linkUserId = state?.link?.userId
  if (typeof linkUserId !== 'string' || !linkUserId.trim()) {
    throw new Error('Robinhood OAuth requires an authenticated link')
  }
  return JSON.stringify({ ...state, [ROBINHOOD_CLIENT_ID_STATE_KEY]: clientId })
}

export async function getRobinhoodOAuthClientIdFromState(state: string) {
  if (!state) return ''
  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, state))
    .limit(1)
  if (!record) return ''

  try {
    const oauthState = JSON.parse(record.value)
    const linkUserId = oauthState?.link?.userId
    if (typeof linkUserId !== 'string' || !linkUserId.trim()) return ''
    const value = oauthState[ROBINHOOD_CLIENT_ID_STATE_KEY]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}
