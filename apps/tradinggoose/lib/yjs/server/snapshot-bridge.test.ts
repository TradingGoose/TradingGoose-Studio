/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockLogger } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/env', () => ({
  env: { INTERNAL_API_SECRET: 'internal-secret' },
  getInternalRealtimeUrl: () => 'http://socket.test',
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

beforeEach(() => {
  vi.resetModules()
  mockFetch.mockReset()
  mockLogger.warn.mockReset()
  mockLogger.error.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('applyEntityStateInSocketServer', () => {
  it('posts watchlist entity fields and returns the canonical persisted fields', async () => {
    const persistedFields = {
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          id: 'listing-1',
          type: 'listing',
          listing: {
            listing_type: 'default',
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
          },
        },
      ],
    }
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, fields: persistedFields }), { status: 200 })
    )

    const { applyEntityStateInSocketServer } = await import('./snapshot-bridge')

    await expect(
      applyEntityStateInSocketServer('watchlist-1', 'watchlist', {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [],
      })
    ).resolves.toEqual(persistedFields)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://socket.test/internal/yjs/entities/watchlist-1/apply-state')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(new Headers(init.headers).entries())).toMatchObject({
      'content-type': 'application/json',
      'x-internal-secret': 'internal-secret',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      entityKind: 'watchlist',
      fields: {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [],
      },
    })
  })

  it.each([
    ['missing fields', { success: true }],
    ['null fields', { success: true, fields: null }],
    ['array fields', { success: true, fields: [] }],
    ['primitive fields', { success: true, fields: 'not-an-object' }],
  ])('rejects malformed success responses with %s', async (_label, payload) => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    const { applyEntityStateInSocketServer } = await import('./snapshot-bridge')

    await expect(
      applyEntityStateInSocketServer('watchlist-1', 'watchlist', {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [],
      })
    ).rejects.toThrow('Socket server returned malformed entity fields')
  })
})

describe('refreshEntityListSession', () => {
  it('leaves failed-refresh cleanup to the socket server that owns the exact document', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [refreshUrl] = mockFetch.mock.calls[0]
    expect(refreshUrl).toContain('/internal/yjs/sessions/list%3Askill%3Aworkspace-1/members')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to refresh entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('does not fail the committed mutation when projection refresh fails', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})

describe('withYjsSessionDeletionLease', () => {
  it('commits the lease only after the database mutation succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ leaseId: 'lease-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const mutate = vi.fn(async () => 'deleted')
    const { withYjsSessionDeletionLease } = await import('./snapshot-bridge')

    await expect(withYjsSessionDeletionLease(['watchlist-1'], mutate)).resolves.toBe('deleted')

    expect(mockFetch.mock.calls[0]?.[0]).toBe('http://socket.test/internal/yjs/session-deletions')
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1].body))).toEqual({
      sessionIds: ['watchlist-1'],
    })
    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'http://socket.test/internal/yjs/session-deletions/lease-1/commit'
    )
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('aborts the lease when the database mutation fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ leaseId: 'lease-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const { withYjsSessionDeletionLease } = await import('./snapshot-bridge')

    await expect(
      withYjsSessionDeletionLease(['layout-1'], async () => {
        throw new Error('database offline')
      })
    ).rejects.toThrow('database offline')

    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'http://socket.test/internal/yjs/session-deletions/lease-2'
    )
    expect(mockFetch.mock.calls[1]?.[1].method).toBe('DELETE')
  })
})
