/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbTransaction, mockFetch, mockLogger } = vi.hoisted(() => ({
  mockDbTransaction: vi.fn(),
  mockFetch: vi.fn(),
  mockLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db', () => ({
  db: { transaction: mockDbTransaction },
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
  mockDbTransaction.mockReset()
  mockLogger.warn.mockReset()
  mockLogger.error.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('runYjsDrainFencedTransaction', () => {
  it('drains normalized targets inside the shared transaction fence', async () => {
    const events: string[] = []
    const tx = {
      execute: vi.fn(async () => {
        events.push('lock')
        return []
      }),
    }
    mockFetch.mockImplementation(async () => {
      events.push('drain')
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })
    const { runYjsDrainFencedTransaction } = await import('./snapshot-bridge')

    await runYjsDrainFencedTransaction(
      { sessionIds: ['watchlist-1'] },
      async () => void events.push('mutation'),
      tx as unknown as Parameters<typeof runYjsDrainFencedTransaction>[2]
    )

    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(events.slice(-2)).toEqual(['drain', 'mutation'])
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1].body))).toEqual({
      sessionIds: ['watchlist-1'],
      workspaceIds: [],
    })
  })

  it('normalizes an unavailable realtime drain to the saved-entity contract', async () => {
    vi.useFakeTimers()
    mockDbTransaction.mockImplementation((run) =>
      run({ execute: vi.fn(async () => [] as unknown[]) })
    )
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const { runYjsDrainFencedTransaction } = await import('./snapshot-bridge')

    const drained = expect(
      runYjsDrainFencedTransaction({ sessionIds: ['watchlist-1'] }, vi.fn())
    ).rejects.toMatchObject({
      name: 'SavedEntityRealtimeRequiredError',
      status: 503,
    })
    await vi.runAllTimersAsync()

    await drained
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const applyEntityState = async (fields: Record<string, unknown>) =>
  (await import('./snapshot-bridge')).applyEntityStateInSocketServer(
    'watchlist-1',
    'watchlist',
    'workspace-1',
    'user-1',
    fields
  )

describe('applyEntityStateInSocketServer', () => {
  it('posts watchlist entity fields and returns the canonical persisted fields', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal)
    const persistedFields = {
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [],
    }
    mockFetch
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 35_000))
        throw new DOMException('Timed out', 'TimeoutError')
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, fields: persistedFields }), { status: 200 })
      )

    const request = expect(applyEntityState(persistedFields)).resolves.toEqual(persistedFields)
    await vi.advanceTimersByTimeAsync(35_000)
    await vi.advanceTimersByTimeAsync(250)
    await request

    expect(timeout).toHaveBeenNthCalledWith(1, 35_000)
    timeout.mockRestore()
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('http://socket.test/internal/yjs/entities/watchlist-1/apply-state')
    expect(init).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal) })
    const firstHeaders = new Headers(mockFetch.mock.calls[0]![1].headers)
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    expect(headers).toMatchObject({
      'content-type': 'application/json',
      'x-internal-secret': 'internal-secret',
      'x-yjs-actor-user-id': 'user-1',
      'x-yjs-deadline': '1035000',
      'x-yjs-request-id': expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
    })
    expect(firstHeaders.get('x-yjs-request-id')).toBe(headers['x-yjs-request-id'])
    expect(firstHeaders.get('x-yjs-deadline')).toBe(headers['x-yjs-deadline'])
    expect(JSON.parse(String(init.body))).toEqual({
      entityKind: 'watchlist',
      workspaceId: 'workspace-1',
      fields: persistedFields,
    })

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'Invalid widget target', code: 'invalid_widget_target' }),
        { status: 422 }
      )
    )
    await expect(applyEntityState({})).rejects.toMatchObject({
      status: 422,
      code: 'invalid_widget_target',
    })
  })

  it.each([
    ['missing fields', { success: true }],
    ['null fields', { success: true, fields: null }],
    ['array fields', { success: true, fields: [] }],
    ['primitive fields', { success: true, fields: 'not-an-object' }],
  ])('rejects malformed success responses with %s', async (_label, payload) => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(applyEntityState({})).rejects.toThrow(
      'Socket server returned malformed entity fields'
    )
  })
})

describe('refreshEntityListSession', () => {
  it('keeps a committed mutation independent from non-destructive list fanout failure', async () => {
    vi.useFakeTimers()
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const { refreshEntityListSession } = await import('./snapshot-bridge')
    const refresh = refreshEntityListSession('skill', 'workspace-1')
    await vi.runAllTimersAsync()

    await expect(refresh).resolves.toBe(false)

    expect(mockFetch).toHaveBeenCalledTimes(3)
    const [refreshUrl] = mockFetch.mock.calls[0]
    expect(refreshUrl).toContain('/internal/yjs/sessions/list%3Askill%3Aworkspace-1/members')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to refresh entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it.each([
    ['applied', { success: true, applied: true }, true],
    ['without a live document', { success: true, applied: false }, false],
  ])('reports entity-list fanout %s', async (_, body, expected) => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }))
    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBe(expected)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
