import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js'
import { db, verification } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { getCanonicalScopesForProvider } from '@/lib/oauth/oauth'

const ROBINHOOD_RESOURCE = 'https://agent.robinhood.com/mcp/trading'
const ROBINHOOD_CLIENT_ID_STATE_KEY = 'robinhoodClientId'

type RobinhoodClientMetadata = Parameters<typeof registerClient>[1]['clientMetadata'] & {
  application_type: 'native' | 'web'
}

function getApplicationType(redirectUri: string): RobinhoodClientMetadata['application_type'] {
  const { hostname } = new URL(redirectUri)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    ? 'native'
    : 'web'
}

export async function registerRobinhoodOAuthClient(redirectUri: string) {
  const clientMetadata: RobinhoodClientMetadata = {
    application_type: getApplicationType(redirectUri),
    client_name: 'TradingGoose Studio',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
  const registered = await registerClient(ROBINHOOD_RESOURCE, {
    metadata: {
      issuer: ROBINHOOD_RESOURCE,
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
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Invalid OAuth state')
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
    const value = JSON.parse(record.value)?.[ROBINHOOD_CLIENT_ID_STATE_KEY]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}
