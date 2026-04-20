import { account, db } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getTrelloApiKey,
  TRELLO_OAUTH_STATE_COOKIE,
} from '@/lib/trello/auth'

export const dynamic = 'force-dynamic'

const logger = createLogger('TrelloTokenAPI')

interface TrelloMember {
  id?: string
  username?: string
  fullName?: string
}

async function getTrelloMember(apiKey: string, token: string): Promise<TrelloMember | null> {
  const url = new URL('https://api.trello.com/1/members/me')
  url.searchParams.set('fields', 'id,username,fullName')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('token', token)

  const response = await fetch(url)
  if (!response.ok) {
    logger.warn('Trello token validation failed', {
      status: response.status,
      statusText: response.statusText,
    })
    return null
  }

  return response.json()
}

function jsonWithClearedState(body: Record<string, unknown>, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.cookies.set(TRELLO_OAUTH_STATE_COOKIE, '', {
    path: '/',
    maxAge: 0,
  })
  return response
}

function isValidState(request: NextRequest, state: string) {
  const expectedState = request.cookies.get(TRELLO_OAUTH_STATE_COOKIE)?.value?.trim() ?? ''
  return Boolean(state && expectedState && state === expectedState)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request.headers)
    if (!session?.user?.id) {
      return jsonWithClearedState({ error: 'User not authenticated' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    const state = typeof body?.state === 'string' ? body.state.trim() : ''
    if (!isValidState(request, state)) {
      return jsonWithClearedState(
        { error: 'Invalid Trello authorization state' },
        { status: 400 }
      )
    }

    if (!token) {
      return jsonWithClearedState({ error: 'Trello token is required' }, { status: 400 })
    }

    const apiKey = await getTrelloApiKey()
    if (!apiKey) {
      return jsonWithClearedState({ error: 'Trello is not configured' }, { status: 400 })
    }

    const member = await getTrelloMember(apiKey, token)
    const accountId = member?.username || member?.id
    if (!accountId) {
      return jsonWithClearedState({ error: 'Invalid Trello token' }, { status: 400 })
    }

    const now = new Date()
    const existingAccounts = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, session.user.id),
          eq(account.providerId, 'trello'),
          eq(account.accountId, accountId)
        )
      )
      .limit(1)

    const accountData = {
      accessToken: token,
      scope: 'read write',
      updatedAt: now,
    }

    if (existingAccounts[0]) {
      await db.update(account).set(accountData).where(eq(account.id, existingAccounts[0].id))
      return jsonWithClearedState({ success: true, accountId: existingAccounts[0].id })
    }

    const id = crypto.randomUUID()
    await db.insert(account).values({
      id,
      accountId,
      providerId: 'trello',
      userId: session.user.id,
      accessToken: token,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: 'read write',
      password: null,
      createdAt: now,
      updatedAt: now,
    })

    return jsonWithClearedState({ success: true, accountId: id })
  } catch (error) {
    logger.error('Failed to save Trello token', { error })
    return jsonWithClearedState({ error: 'Internal server error' }, { status: 500 })
  }
}
