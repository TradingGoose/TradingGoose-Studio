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
  it('discards the projection so subscribers rebootstrap from DB when refresh fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [refreshUrl] = mockFetch.mock.calls[0]
    expect(refreshUrl).toContain('/internal/yjs/sessions/list%3Askill%3Aworkspace-1/members')
    const [discardUrl, discardInit] = mockFetch.mock.calls[1]
    expect(discardUrl).toBe('http://socket.test/internal/yjs/sessions/list%3Askill%3Aworkspace-1')
    expect(discardInit.method).toBe('DELETE')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to refresh entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('never fails the committed mutation even when the discard also fails', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to discard stale entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
  })
})
