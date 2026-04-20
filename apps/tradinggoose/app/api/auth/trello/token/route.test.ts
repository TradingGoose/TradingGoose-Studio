/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockDb,
  mockEq,
  mockFetch,
  mockGetSession,
  mockGetTrelloApiKey,
  mockInsertValues,
  mockLogger,
  mockSelectLimit,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn()
  const mockInsertValues = vi.fn()
  const mockUpdateWhere = vi.fn()
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
  }

  return {
    mockAnd: vi.fn((...conditions) => ({ conditions })),
    mockDb,
    mockEq: vi.fn((field, value) => ({ field, value })),
    mockFetch: vi.fn(),
    mockGetSession: vi.fn(),
    mockGetTrelloApiKey: vi.fn(),
    mockInsertValues,
    mockLogger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    mockSelectLimit,
    mockUpdateSet,
    mockUpdateWhere,
  }
})

vi.mock('@tradinggoose/db', () => ({
  account: {
    accountId: 'accountId',
    id: 'id',
    providerId: 'providerId',
    userId: 'userId',
  },
  db: mockDb,
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => mockAnd(args),
  eq: (field: unknown, value: unknown) => mockEq(field, value),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/trello/auth', () => ({
  getTrelloApiKey: (...args: unknown[]) => mockGetTrelloApiKey(...args),
  TRELLO_OAUTH_STATE_COOKIE: 'tradinggoose_trello_oauth_state',
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

global.fetch = mockFetch

const TRELLO_STATE_COOKIE = 'tradinggoose_trello_oauth_state'

function createRequest(body: Record<string, unknown>, stateCookie = 'trello-state') {
  return new NextRequest('http://localhost:3000/api/auth/trello/token', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Cookie: stateCookie ? `${TRELLO_STATE_COOKIE}=${stateCookie}` : '',
    },
  })
}

describe('Trello token route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'credential-id'),
    })

    mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetTrelloApiKey.mockResolvedValue('trello-api-key')
    mockSelectLimit.mockResolvedValue([])
    mockInsertValues.mockResolvedValue([])
    mockUpdateWhere.mockResolvedValue([])
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'member-id',
        username: 'trello-user',
        fullName: 'Trello User',
      }),
    })
  })

  it('validates and stores a new Trello credential', async () => {
    const { POST } = await import('./route')
    const response = await POST(createRequest({ token: 'trello-token', state: 'trello-state' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, accountId: 'credential-id' })
    expect(response.headers.get('set-cookie')).toContain(`${TRELLO_STATE_COOKIE}=`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')

    const trelloURL = new URL(String(mockFetch.mock.calls[0][0]))
    expect(trelloURL.pathname).toBe('/1/members/me')
    expect(trelloURL.searchParams.get('key')).toBe('trello-api-key')
    expect(trelloURL.searchParams.get('token')).toBe('trello-token')

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'credential-id',
        accountId: 'trello-user',
        providerId: 'trello',
        userId: 'user-123',
        accessToken: 'trello-token',
        scope: 'read write',
      })
    )
  })

  it('updates an existing Trello credential for the same account', async () => {
    mockSelectLimit.mockResolvedValue([{ id: 'existing-credential-id' }])

    const { POST } = await import('./route')
    const response = await POST(createRequest({ token: 'new-token', state: 'trello-state' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, accountId: 'existing-credential-id' })
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-token',
        scope: 'read write',
      })
    )
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('rejects invalid Trello tokens', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    })

    const { POST } = await import('./route')
    const response = await POST(createRequest({ token: 'bad-token', state: 'trello-state' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid Trello token')
  })

  it('rejects token saves without matching state', async () => {
    const { POST } = await import('./route')
    const response = await POST(createRequest({ token: 'trello-token', state: 'attacker-state' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid Trello authorization state')
    expect(response.headers.get('set-cookie')).toContain(`${TRELLO_STATE_COOKIE}=`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('rejects token saves when the state cookie is missing', async () => {
    const { POST } = await import('./route')
    const response = await POST(createRequest({ token: 'trello-token', state: 'trello-state' }, ''))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid Trello authorization state')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})
