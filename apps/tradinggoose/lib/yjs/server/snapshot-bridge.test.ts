/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/env', () => ({
  env: { INTERNAL_API_SECRET: 'internal-secret' },
  getInternalRealtimeUrl: () => 'http://socket.local',
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    warn: mockWarn,
  })),
}))

describe('refreshEntityListSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockWarn.mockReset()
  })

  it('invalidates the live list projection without failing the committed command', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket unavailable'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/members?')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/internal/yjs/sessions/list%3Askill%3Aworkspace-1'
    )
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to refresh entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
  })
})
