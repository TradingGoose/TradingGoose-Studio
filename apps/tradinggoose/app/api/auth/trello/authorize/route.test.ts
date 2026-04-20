/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetTrelloApiKey, mockLogger } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetTrelloApiKey: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/trello/auth', () => ({
  createTrelloOAuthState: () => 'trello-state',
  getTrelloApiKey: (...args: unknown[]) => mockGetTrelloApiKey(...args),
  getTrelloOAuthStateCookieOptions: () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 600,
  }),
  TRELLO_OAUTH_STATE_COOKIE: 'tradinggoose_trello_oauth_state',
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

describe('Trello authorize route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetTrelloApiKey.mockResolvedValue('trello-api-key')
  })

  it('redirects to Trello authorize with the callback bridge', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/auth/trello/authorize?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fworkspace%2Fws-1%2Fintegrations'
      )
    )

    expect(response.status).toBe(307)

    const location = response.headers.get('location')
    expect(location).toBeTruthy()

    const authorizeURL = new URL(location!)
    expect(authorizeURL.origin).toBe('https://trello.com')
    expect(authorizeURL.pathname).toBe('/1/authorize')
    expect(authorizeURL.searchParams.get('key')).toBe('trello-api-key')
    expect(authorizeURL.searchParams.get('scope')).toBe('read,write')
    expect(authorizeURL.searchParams.get('callback_method')).toBe('fragment')
    expect(authorizeURL.searchParams.get('response_type')).toBe('token')

    const returnURL = new URL(authorizeURL.searchParams.get('return_url')!)
    expect(returnURL.pathname).toBe('/auth/trello/callback')
    expect(returnURL.searchParams.get('callbackURL')).toBe(
      'http://localhost:3000/workspace/ws-1/integrations'
    )
    expect(returnURL.searchParams.get('state')).toBe('trello-state')

    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('tradinggoose_trello_oauth_state=trello-state')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
  })

  it('redirects back with an error when Trello is not configured', async () => {
    mockGetTrelloApiKey.mockResolvedValue('')

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/auth/trello/authorize?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fworkspace%2Fws-1%2Fintegrations'
      )
    )

    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/workspace/ws-1/integrations')
    expect(location.searchParams.get('error')).toBe('trello_not_configured')
  })
})
