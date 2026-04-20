import { loadSystemOAuthClientCredentialsForProvider } from '@/lib/oauth/system-managed-config'

export const TRELLO_OAUTH_STATE_COOKIE = 'tradinggoose_trello_oauth_state'
export const TRELLO_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60

export function createTrelloOAuthState() {
  return crypto.randomUUID()
}

export function getTrelloOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TRELLO_OAUTH_STATE_MAX_AGE_SECONDS,
  }
}

export async function getTrelloApiKey() {
  const credentials = await loadSystemOAuthClientCredentialsForProvider('trello')
  return credentials?.clientId?.trim() || ''
}
