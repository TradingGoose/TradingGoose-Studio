/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthenticateV1Request = vi.fn()
const mockIsBillingEnabledForRuntime = vi.fn()
const mockGetPersonalEffectiveSubscription = vi.fn()

vi.mock('@/lib/billing/core/subscription', () => ({
  getPersonalEffectiveSubscription: (...args: any[]) =>
    mockGetPersonalEffectiveSubscription(...args),
}))

vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: (...args: any[]) => mockIsBillingEnabledForRuntime(...args),
}))

vi.mock('./auth', () => ({
  authenticateV1Request: (...args: any[]) => mockAuthenticateV1Request(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/services/queue/RateLimiter', () => ({
  RateLimiter: class {
    checkRateLimitWithSubscription = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 5,
      resetAt: new Date('2026-04-12T00:01:00.000Z'),
    })

    getRateLimitStatusWithSubscription = vi.fn().mockResolvedValue({
      used: 0,
      limit: 10,
      remaining: 10,
      resetAt: new Date('2026-04-12T00:01:00.000Z'),
    })
  },
}))

function createRequest() {
  return new NextRequest('http://localhost:3000/api/v1/logs')
}

describe('v1 rate-limit middleware', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
    })
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue({
      id: 'subscription-1',
      referenceType: 'user',
      referenceId: 'user-1',
      tier: {
        id: 'tier-1',
      },
    })
  })

  it('fails open for authenticated requests when subscription lookup throws', async () => {
    mockGetPersonalEffectiveSubscription.mockRejectedValueOnce(new Error('subscription lookup failed'))

    const { checkRateLimit } = await import('@/app/api/v1/middleware')
    const result = await checkRateLimit(createRequest(), 'logs')

    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.userId).toBe('user-1')
    expect(result.error).toBeUndefined()
  })

  it('still rejects unauthenticated requests', async () => {
    mockAuthenticateV1Request.mockResolvedValueOnce({
      authenticated: false,
      error: 'Unauthorized',
    })

    const { checkRateLimit } = await import('@/app/api/v1/middleware')
    const result = await checkRateLimit(createRequest(), 'logs')

    expect(result.allowed).toBe(false)
    expect(result.error).toBe('Unauthorized')
  })
})
