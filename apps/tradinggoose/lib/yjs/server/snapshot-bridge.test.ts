/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockLogger } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockLogger: {
    warn: vi.fn(),
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
  vi.stubGlobal('fetch', mockFetch)
})

describe('refreshEntityListSession', () => {
  it('logs and discards the live projection when refresh fails', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))

    const { refreshEntityListSession } = await import('./snapshot-bridge')

    await expect(refreshEntityListSession('skill', 'workspace-1')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to refresh entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to discard stale entity-list projection',
      expect.objectContaining({ entityKind: 'skill', workspaceId: 'workspace-1' })
    )
  })
})
