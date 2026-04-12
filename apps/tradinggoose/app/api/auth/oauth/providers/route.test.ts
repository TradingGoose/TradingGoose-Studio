/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetOAuthProviderAvailability, mockLogger } = vi.hoisted(() => ({
  mockGetOAuthProviderAvailability: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@/lib/oauth/provider-availability.server', () => ({
  getOAuthProviderAvailability: (...args: unknown[]) => mockGetOAuthProviderAvailability(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

describe('OAuth providers availability route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns provider availability for the requested providers', async () => {
    mockGetOAuthProviderAvailability.mockResolvedValue({
      github: true,
      google: false,
    })

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/auth/oauth/providers?providers=github,google')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      github: true,
      google: false,
    })
    expect(mockGetOAuthProviderAvailability).toHaveBeenCalledWith(['github', 'google'])
  })

  it('falls back to an empty availability map when resolution fails', async () => {
    mockGetOAuthProviderAvailability.mockRejectedValue(new Error('resolver failed'))

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/auth/oauth/providers?providers=github,google')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
