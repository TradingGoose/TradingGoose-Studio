import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import {
  createTrelloOAuthState,
  getTrelloApiKey,
  getTrelloOAuthStateCookieOptions,
  TRELLO_OAUTH_STATE_COOKIE,
} from '@/lib/trello/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TrelloAuthorizeAPI')

function getSafeCallbackURL(request: NextRequest) {
  const appUrl = new URL(getBaseUrl())
  const rawCallbackURL = request.nextUrl.searchParams.get('callbackURL') || '/'

  try {
    const callbackURL = new URL(rawCallbackURL, appUrl.origin)
    if (callbackURL.origin !== appUrl.origin) {
      return appUrl.origin
    }

    return callbackURL.toString()
  } catch {
    return appUrl.origin
  }
}

function redirectWithError(callbackURL: string, error: string) {
  const redirectURL = new URL(callbackURL)
  redirectURL.searchParams.set('error', error)
  return NextResponse.redirect(redirectURL)
}

export async function GET(request: NextRequest) {
  const callbackURL = getSafeCallbackURL(request)

  try {
    const session = await getSession(request.headers)
    if (!session?.user?.id) {
      return redirectWithError(callbackURL, 'user_not_authenticated')
    }

    const apiKey = await getTrelloApiKey()
    if (!apiKey) {
      return redirectWithError(callbackURL, 'trello_not_configured')
    }

    const state = createTrelloOAuthState()
    const returnURL = new URL('/api/auth/trello/callback', getBaseUrl())
    returnURL.searchParams.set('callbackURL', callbackURL)
    returnURL.searchParams.set('state', state)

    const authorizeURL = new URL('https://trello.com/1/authorize')
    authorizeURL.searchParams.set('expiration', 'never')
    authorizeURL.searchParams.set('name', 'TradingGoose')
    authorizeURL.searchParams.set('scope', 'read,write')
    authorizeURL.searchParams.set('response_type', 'token')
    authorizeURL.searchParams.set('callback_method', 'fragment')
    authorizeURL.searchParams.set('return_url', returnURL.toString())
    authorizeURL.searchParams.set('key', apiKey)

    const response = NextResponse.redirect(authorizeURL)
    response.cookies.set(TRELLO_OAUTH_STATE_COOKIE, state, getTrelloOAuthStateCookieOptions())
    return response
  } catch (error) {
    logger.error('Failed to start Trello authorization', { error })
    return redirectWithError(callbackURL, 'trello_authorization_failed')
  }
}
