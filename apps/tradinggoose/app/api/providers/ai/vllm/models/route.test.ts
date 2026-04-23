/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockFilterBlacklistedModels, mockResolveVllmServiceConfig } = vi.hoisted(
  () => ({
    mockFetch: vi.fn(),
    mockFilterBlacklistedModels: vi.fn((models: string[]) => models),
    mockResolveVllmServiceConfig: vi.fn(),
  })
)

vi.mock('@/lib/system-services/runtime', () => ({
  resolveVllmServiceConfig: (...args: unknown[]) => mockResolveVllmServiceConfig(...args),
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

describe('vLLM models route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('returns no models when the vLLM system service has no base URL', async () => {
    mockResolveVllmServiceConfig.mockResolvedValue({
      apiKey: null,
      baseUrl: null,
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches models with the vLLM system service configuration', async () => {
    mockResolveVllmServiceConfig.mockResolvedValue({
      apiKey: 'svc-vllm-key',
      baseUrl: 'http://vllm.internal/',
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'foo' }, { id: 'bar' }],
      }),
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(mockFetch).toHaveBeenCalledWith(
      'http://vllm.internal/v1/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer svc-vllm-key',
          'Content-Type': 'application/json',
        },
        next: { revalidate: 60 },
      })
    )
    expect(mockFilterBlacklistedModels).toHaveBeenCalledWith(['vllm/foo', 'vllm/bar'])
    expect(await response.json()).toEqual({
      models: ['vllm/foo', 'vllm/bar'],
    })
  })
})
