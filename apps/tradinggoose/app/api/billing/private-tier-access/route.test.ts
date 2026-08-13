/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_TIER_ACCESS_ERROR_CODES } from '@/lib/billing/private-tier-access-contract'

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

  it('persists an exact access-code grant for the read query to refresh', async () => {
    const tier = { id: 'private-tier', displayOrder: 2 }
    mockGrantPrivateBillingTier.mockResolvedValue(tier)

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: ' private-code ' }),
      })
    )

    expect(response.status).toBe(204)
    expect(mockGrantPrivateBillingTier).toHaveBeenCalledWith('user-1', 'private-code')
    expect(mockGetGrantedPrivateBillingTiers).not.toHaveBeenCalled()
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
    await expect(blankResponse.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.required,
    })
    expect(mockGrantPrivateBillingTier).not.toHaveBeenCalled()
  })

  it('rejects invalid access codes with a stable code', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: 'invalid-private-access-code' }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.invalid,
    })
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
    await expect(response.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.rateLimited,
    })
    expect(mockCheckPrivateTierAccessRateLimit).toHaveBeenCalledWith('user-1')
    expect(mockGrantPrivateBillingTier).not.toHaveBeenCalled()
  })

  it('reports a rate-limit dependency failure without exposing service copy', async () => {
    mockCheckPrivateTierAccessRateLimit.mockResolvedValue({
      allowed: false,
      error: 'Rate limit service unavailable',
      failureKind: 'dependency',
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: 'a-random-private-access-code' }),
      })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.unavailable,
    })
  })

  it('returns stable unauthorized codes for reads and grants', async () => {
    mockGetSession.mockResolvedValue(null)
    const { GET, POST } = await import('./route')

    const getResponse = await GET()
    const postResponse = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: 'a-random-private-access-code' }),
      })
    )

    expect(getResponse.status).toBe(401)
    await expect(getResponse.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.unauthorized,
    })
    expect(postResponse.status).toBe(401)
    await expect(postResponse.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.unauthorized,
    })
  })

  it('returns operation-specific stable codes for unexpected failures', async () => {
    mockGetGrantedPrivateBillingTiers.mockRejectedValueOnce(new Error('database unavailable'))
    const { GET, POST } = await import('./route')

    const getResponse = await GET()
    expect(getResponse.status).toBe(500)
    await expect(getResponse.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed,
    })

    mockGrantPrivateBillingTier.mockRejectedValueOnce(new Error('database unavailable'))
    const postResponse = await POST(
      new Request('http://localhost/api/billing/private-tier-access', {
        method: 'POST',
        body: JSON.stringify({ accessCode: 'a-random-private-access-code' }),
      })
    )
    expect(postResponse.status).toBe(500)
    await expect(postResponse.json()).resolves.toEqual({
      code: PRIVATE_TIER_ACCESS_ERROR_CODES.validateFailed,
    })
  })
})
