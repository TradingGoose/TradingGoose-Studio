/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetGrantedPrivateBillingTiers,
  mockGrantPrivateBillingTier,
  mockCheckPrivateTierAccessRateLimit,
  mockToBillingTierDisplay,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetGrantedPrivateBillingTiers: vi.fn(),
  mockGrantPrivateBillingTier: vi.fn(),
  mockCheckPrivateTierAccessRateLimit: vi.fn(),
  mockToBillingTierDisplay: vi.fn((tier) => tier),
  mockLogger: { error: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@/lib/billing/catalog', () => ({
  toBillingTierDisplay: (tier: unknown) => mockToBillingTierDisplay(tier),
}))

vi.mock('@/lib/billing/private-tier-access', () => ({
  checkPrivateTierAccessRateLimit: (userId: string) => mockCheckPrivateTierAccessRateLimit(userId),
  getGrantedPrivateBillingTiers: (userId: string) => mockGetGrantedPrivateBillingTiers(userId),
  grantPrivateBillingTier: (userId: string, accessCode: string) =>
    mockGrantPrivateBillingTier(userId, accessCode),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

describe('/api/billing/private-tier-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetGrantedPrivateBillingTiers.mockResolvedValue([])
    mockGrantPrivateBillingTier.mockResolvedValue(null)
    mockCheckPrivateTierAccessRateLimit.mockResolvedValue({ allowed: true })
  })

  it('returns only the active private tiers granted to the user', async () => {
    const tier = { id: 'private-tier', displayOrder: 2 }
    mockGetGrantedPrivateBillingTiers.mockResolvedValue([tier])

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ privateTiers: [tier] })
    expect(mockGetGrantedPrivateBillingTiers).toHaveBeenCalledWith('user-1')
  })

  it('persists an exact access-code grant and returns the refreshed tiers', async () => {
    const tier = { id: 'private-tier', displayOrder: 2 }
    mockGrantPrivateBillingTier.mockResolvedValue(tier)
    mockGetGrantedPrivateBillingTiers.mockResolvedValue([tier])

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: ' private-code ' }),
      })
    )

    expect(response.status).toBe(200)
    expect(mockGrantPrivateBillingTier).toHaveBeenCalledWith('user-1', 'private-code')
    await expect(response.json()).resolves.toEqual({ privateTiers: [tier] })
  })

  it('rejects blank access codes', async () => {
    const { POST } = await import('./route')
    const blankResponse = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: '   ' }),
      })
    )

    expect(blankResponse.status).toBe(400)
    expect(mockGrantPrivateBillingTier).not.toHaveBeenCalled()
  })

  it('rate-limits access-code validation per user', async () => {
    mockCheckPrivateTierAccessRateLimit.mockResolvedValue({ allowed: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: 'a-random-private-access-code' }),
      })
    )

    expect(response.status).toBe(429)
    expect(mockCheckPrivateTierAccessRateLimit).toHaveBeenCalledWith('user-1')
    expect(mockGrantPrivateBillingTier).not.toHaveBeenCalled()
  })
})
