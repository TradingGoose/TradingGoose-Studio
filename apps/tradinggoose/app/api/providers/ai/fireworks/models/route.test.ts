/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetch,
  mockFilterBlacklistedModels,
  mockResolveFireworksServiceConfig,
} = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockFilterBlacklistedModels: vi.fn((models: string[]) => models),
  mockResolveFireworksServiceConfig: vi.fn(),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveFireworksServiceConfig: (...args: unknown[]) =>
    mockResolveFireworksServiceConfig(...args),
}))

vi.mock('@/providers/ai/utils', () => ({
  filterBlacklistedModels: (...args: unknown[]) => mockFilterBlacklistedModels(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('Fireworks models route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('returns no models when the Fireworks system service has no API key', async () => {
    mockResolveFireworksServiceConfig.mockResolvedValue({
      apiKey: null,
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches models with the Fireworks system service API key', async () => {
    mockResolveFireworksServiceConfig.mockResolvedValue({
      apiKey: 'svc-fireworks-key',
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'accounts/fire-1' }, { id: 'accounts/fire-1' }, { id: 'fire-2' }],
      }),
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.fireworks.ai/inference/v1/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer svc-fireworks-key',
          'Content-Type': 'application/json',
        },
        next: { revalidate: 300 },
      })
    )
    expect(mockFilterBlacklistedModels).toHaveBeenCalledWith([
      'fireworks/accounts/fire-1',
      'fireworks/fire-2',
    ])
    expect(await response.json()).toEqual({
      models: ['fireworks/accounts/fire-1', 'fireworks/fire-2'],
    })
  })
})
