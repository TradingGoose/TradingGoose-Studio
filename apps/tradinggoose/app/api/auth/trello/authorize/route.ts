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
import { normalizeCallbackUrl } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TrelloAuthorizeAPI')

function getCallbackPath(request: NextRequest) {
  const appUrl = new URL(getBaseUrl())
  return normalizeCallbackUrl(request.nextUrl.searchParams.get('callbackURL'), appUrl.origin)
}

function redirectWithError(callbackPath: string, error: string) {
  const redirectURL = new URL(callbackPath, getBaseUrl())
  redirectURL.searchParams.set('error', error)
  return NextResponse.redirect(redirectURL)
}

export async function GET(request: NextRequest) {
  const callbackPath = getCallbackPath(request)
  if (!callbackPath) {
    return NextResponse.json({ error: 'invalid_callback_url' }, { status: 400 })
  }

  try {
    const session = await getSession(request.headers)
    if (!session?.user?.id) {
      return redirectWithError(callbackPath, 'user_not_authenticated')
    }

    const apiKey = await getTrelloApiKey()
    if (!apiKey) {
      return redirectWithError(callbackPath, 'trello_not_configured')
    }

    const state = createTrelloOAuthState()
    const returnURL = new URL('/api/auth/trello/callback', getBaseUrl())
    returnURL.searchParams.set('callbackURL', callbackPath)
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
    return redirectWithError(callbackPath, 'trello_authorization_failed')
  }
}
