import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetOAuthProviderAvailability } = vi.hoisted(() => ({
  mockGetOAuthProviderAvailability: vi.fn(),
}))

vi.mock('@/lib/oauth/provider-availability.server', () => ({
  getOAuthProviderAvailability: (...args: unknown[]) => mockGetOAuthProviderAvailability(...args),
}))

vi.mock('@/lib/environment', () => ({
  isProd: true,
}))

describe('oauth provider checker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('uses system-managed provider availability for social login buttons', async () => {
    mockGetOAuthProviderAvailability.mockResolvedValue({
      github: true,
      google: false,
    })

    const { getOAuthProviderStatus } = await import('./oauth-provider-checker')

    await expect(getOAuthProviderStatus()).resolves.toEqual({
      githubAvailable: true,
      googleAvailable: false,
      isProduction: true,
    })
    expect(mockGetOAuthProviderAvailability).toHaveBeenCalledWith(['github', 'google'])
  })

  it('falls back to disabled social login buttons when provider availability fails', async () => {
    mockGetOAuthProviderAvailability.mockRejectedValue(new Error('resolver failed'))

    const { getOAuthProviderStatus } = await import('./oauth-provider-checker')

    await expect(getOAuthProviderStatus()).resolves.toEqual({
      githubAvailable: false,
      googleAvailable: false,
      isProduction: true,
    })
    expect(mockGetOAuthProviderAvailability).toHaveBeenCalledWith(['github', 'google'])
  })
})
