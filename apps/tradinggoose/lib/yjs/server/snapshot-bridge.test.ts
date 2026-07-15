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
      applyEntityStateInSocketServer('watchlist-1', 'watchlist', 'workspace-1', {
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
      workspaceId: 'workspace-1',
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
      applyEntityStateInSocketServer('watchlist-1', 'watchlist', 'workspace-1', {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [],
      })
    ).rejects.toThrow('Socket server returned malformed entity fields')
  })
})

describe('refreshEntityListSession', () => {
  it('keeps a committed mutation independent from non-destructive list fanout failure', async () => {
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

  it('does not fail the committed mutation when access notification fails', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { notifyWorkspaceYjsAccessChanged } = await import('./snapshot-bridge')

    await expect(
      notifyWorkspaceYjsAccessChanged('workspace-1', ['user-1'])
    ).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'http://socket.test/internal/yjs/workspaces/workspace-1/access-changed'
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to notify realtime server about workspace access changes',
      expect.objectContaining({ workspaceId: 'workspace-1', userIds: ['user-1'] })
    )
  })
})

describe('withYjsSessionDeletionLease', () => {
  it('retries lost begin and commit acknowledgements with the same lease', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('begin response lost'))
      .mockResolvedValueOnce(new Response('timeout', { status: 408 }))
      .mockImplementationOnce(async (_url, init) => {
        const leaseId = JSON.parse(String(init?.body)).leaseId
        return new Response(JSON.stringify({ leaseId }), { status: 200 })
      })
      .mockRejectedValueOnce(new TypeError('commit response lost'))
      .mockResolvedValueOnce(new Response('timeout', { status: 408 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const mutate = vi.fn(async () => {
      expect(mockFetch).toHaveBeenCalledTimes(3)
      return 'deleted'
    })
    const { withYjsSessionDeletionLease } = await import('./snapshot-bridge')

    await expect(
      withYjsSessionDeletionLease({ sessionIds: ['watchlist-1'] }, mutate)
    ).resolves.toBe('deleted')

    const beginBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1].body))
    expect(beginBody).toEqual({
      leaseId: expect.any(String),
      sessionIds: ['watchlist-1'],
    })
    for (const [, init] of mockFetch.mock.calls.slice(0, 3)) {
      expect(JSON.parse(String(init?.body))).toEqual(beginBody)
    }
    expect(mockFetch.mock.calls[3]?.[0]).toBe(
      `http://socket.test/internal/yjs/session-deletions/${beginBody.leaseId}/commit`
    )
    expect(mockFetch.mock.calls[4]?.[0]).toBe(mockFetch.mock.calls[3]?.[0])
    expect(mockFetch.mock.calls[5]?.[0]).toBe(mockFetch.mock.calls[3]?.[0])
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('aborts the lease when the database mutation fails', async () => {
    mockFetch
      .mockImplementationOnce(async (_url, init) => {
        const leaseId = JSON.parse(String(init?.body)).leaseId
        return new Response(JSON.stringify({ leaseId }), { status: 200 })
      })
      .mockRejectedValueOnce(new TypeError('abort response lost'))
      .mockResolvedValueOnce(new Response('timeout', { status: 408 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const { withYjsSessionDeletionLease } = await import('./snapshot-bridge')

    await expect(
      withYjsSessionDeletionLease({ workspaceIds: ['workspace-1'] }, async () => {
        throw new Error('database offline')
      })
    ).rejects.toThrow('database offline')

    expect(mockFetch.mock.calls[2]?.[0]).toBe(mockFetch.mock.calls[1]?.[0])
    expect(mockFetch.mock.calls[3]?.[0]).toBe(mockFetch.mock.calls[1]?.[0])
    expect(mockFetch.mock.calls[1]?.[1].method).toBe('DELETE')
    expect(mockFetch.mock.calls[2]?.[1].method).toBe('DELETE')
    expect(mockFetch.mock.calls[3]?.[1].method).toBe('DELETE')
  })
})
