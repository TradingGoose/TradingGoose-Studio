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

vi.mock('@/services/queue/ExecutionLimiter', () => ({
  ExecutionLimiter: class {
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

  it('fails closed with a 503 when subscription lookup throws', async () => {
    mockGetPersonalEffectiveSubscription.mockRejectedValueOnce(new Error('subscription lookup failed'))

    const { checkRateLimit, createRateLimitResponse } = await import('@/app/api/v1/middleware')
    const result = await checkRateLimit(createRequest(), 'logs')

    expect(result.allowed).toBe(false)
    expect(result.failureKind).toBe('dependency')
    expect(result.limit).toBe(0)
    expect(result.remaining).toBe(0)
    expect(result.userId).toBe('user-1')
    expect(result.error).toBe('Rate limit service unavailable')

    const response = createRateLimitResponse(result)
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBeTruthy()
  })

  it('still rejects unauthenticated requests', async () => {
    mockAuthenticateV1Request.mockResolvedValueOnce({
      authenticated: false,
      error: 'Unauthorized',
    })

    const { checkRateLimit, createRateLimitResponse } = await import('@/app/api/v1/middleware')
    const result = await checkRateLimit(createRequest(), 'logs')

    expect(result.allowed).toBe(false)
    expect(result.failureKind).toBe('auth')
    expect(result.error).toBe('Unauthorized')

    const response = createRateLimitResponse(result)
    expect(response.status).toBe(401)
  })

  it('returns 429 for exhausted rate limits', async () => {
    const { createRateLimitResponse } = await import('@/app/api/v1/middleware')
    const response = createRateLimitResponse({
      allowed: false,
      remaining: 0,
      limit: 10,
      resetAt: new Date('2026-04-12T00:01:00.000Z'),
      userId: 'user-1',
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Rate limit exceeded',
    })
  })
})
