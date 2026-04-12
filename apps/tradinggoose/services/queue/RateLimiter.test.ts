import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEffectiveSubscription } from '@/lib/billing/core/subscription'
import { RateLimiter } from '@/services/queue/RateLimiter'
import { MANUAL_EXECUTION_LIMIT } from '@/services/queue/types'

const TEST_RATE_LIMITS = {
  syncPerMinute: 10,
  asyncPerMinute: 50,
  apiEndpointPerMinute: 10,
} as const

// Mock the database module
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
  sql: vi.fn((strings, ...values) => ({ sql: strings.join('?'), values })),
  and: vi.fn((...conditions) => ({ and: conditions })),
}))

// Mock getEffectiveSubscription
vi.mock('@/lib/billing/core/subscription', () => ({
  getEffectiveSubscription: vi.fn().mockResolvedValue(null),
}))

const mockIsBillingEnabledForRuntime = vi.fn().mockResolvedValue(true)

vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: (...args: any[]) => mockIsBillingEnabledForRuntime(...args),
}))

vi.mock('@/lib/billing/tiers', () => ({
  getSubscriptionBillingScope: vi.fn(
    (
      userId: string,
      subscription: {
        referenceId: string
        tier?: { usageScope?: string; ownerType?: string }
      } | null
    ) => ({
      scopeId:
        subscription?.tier?.usageScope === 'pooled' && subscription.referenceId
          ? subscription.referenceId
          : userId,
      scopeType:
        subscription?.tier?.usageScope === 'pooled' &&
        subscription?.tier?.ownerType === 'organization'
          ? 'organization'
          : 'user',
    })
  ),
  getTierRateLimits: vi.fn(
    (
      tier: {
        syncRateLimitPerMinute?: number | null
        asyncRateLimitPerMinute?: number | null
        apiEndpointRateLimitPerMinute?: number | null
      } | null
    ) =>
      tier
        ? {
            syncPerMinute: tier.syncRateLimitPerMinute ?? 0,
            asyncPerMinute: tier.asyncRateLimitPerMinute ?? 0,
            apiEndpointPerMinute: tier.apiEndpointRateLimitPerMinute ?? 0,
          }
        : {
            syncPerMinute: 0,
            asyncPerMinute: 0,
            apiEndpointPerMinute: 0,
          }
  ),
}))

import { db } from '@tradinggoose/db'

describe('RateLimiter', () => {
  const rateLimiter = new RateLimiter()
  const testUserId = 'test-user-123'
  const subscribedTier = {
    id: 'tier_default',
    displayName: 'Community',
    ownerType: 'user' as const,
    usageScope: 'individual' as const,
    seatMode: 'fixed' as const,
    syncRateLimitPerMinute: 10,
    asyncRateLimitPerMinute: 50,
    apiEndpointRateLimitPerMinute: 10,
    monthlyPriceUsd: null,
    yearlyPriceUsd: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    vi.mocked(getEffectiveSubscription).mockResolvedValue({
      id: 'subscription-1',
      referenceType: 'user',
      referenceId: testUserId,
      status: 'active',
      tier: subscribedTier,
    } as any)
  })

  describe('checkRateLimit', () => {
    it('should allow unlimited requests for manual trigger type', async () => {
      const result = await rateLimiter.checkRateLimit(testUserId, 'manual', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(result.resetAt).toBeInstanceOf(Date)
      expect(db.select).not.toHaveBeenCalled()
    })

    it('should allow first API request for sync execution', async () => {
      // Mock select to return empty array (no existing record)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No existing record
          }),
        }),
      } as any)

      // Mock insert to return the expected structure
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 1,
                asyncApiRequests: 0,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimit(testUserId, 'api', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(TEST_RATE_LIMITS.syncPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should allow first API request for async execution', async () => {
      // Mock select to return empty array (no existing record)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No existing record
          }),
        }),
      } as any)

      // Mock insert to return the expected structure
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 0,
                asyncApiRequests: 1,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimit(testUserId, 'api', true)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(TEST_RATE_LIMITS.asyncPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should work for all trigger types except manual', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const

      for (const triggerType of triggerTypes) {
        // Mock select to return empty array (no existing record)
        vi.mocked(db.select).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // No existing record
            }),
          }),
        } as any)

        // Mock insert to return the expected structure
        vi.mocked(db.insert).mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  syncApiRequests: 1,
                  asyncApiRequests: 0,
                  windowStart: new Date(),
                },
              ]),
            }),
          }),
        } as any)

        const result = await rateLimiter.checkRateLimit(testUserId, triggerType, false)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(TEST_RATE_LIMITS.syncPerMinute - 1)
      }
    })

    it('skips rate limiting entirely when billing is disabled', async () => {
      mockIsBillingEnabledForRuntime.mockResolvedValue(false)

      const result = await rateLimiter.checkRateLimit(testUserId, 'api', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER)
      expect(db.select).not.toHaveBeenCalled()
    })

    it('blocks billed requests when the user has no active subscription tier', async () => {
      vi.mocked(getEffectiveSubscription).mockResolvedValueOnce(null)

      const result = await rateLimiter.checkRateLimit(testUserId, 'api', false)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(db.select).not.toHaveBeenCalled()
    })
  })

  describe('getRateLimitStatus', () => {
    it('should return unlimited for manual trigger type', async () => {
      const status = await rateLimiter.getRateLimitStatus(testUserId, 'manual', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('should return sync API limits for API trigger type', async () => {
      const mockSelect = vi.fn().mockReturnThis()
      const mockFrom = vi.fn().mockReturnThis()
      const mockWhere = vi.fn().mockReturnThis()
      const mockLimit = vi.fn().mockResolvedValue([])

      vi.mocked(db.select).mockReturnValue({
        from: mockFrom,
        where: mockWhere,
        limit: mockLimit,
      } as any)

      const status = await rateLimiter.getRateLimitStatus(testUserId, 'api', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(TEST_RATE_LIMITS.syncPerMinute)
      expect(status.remaining).toBe(TEST_RATE_LIMITS.syncPerMinute)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('returns a blocked rate-limit status when billing is enabled but no subscription exists', async () => {
      vi.mocked(getEffectiveSubscription).mockResolvedValueOnce(null)

      const status = await rateLimiter.getRateLimitStatus(testUserId, 'api', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(0)
      expect(status.remaining).toBe(0)
      expect(db.select).not.toHaveBeenCalled()
    })
  })

  describe('resetRateLimit', () => {
    it('should delete rate limit record for user', async () => {
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      } as any)

      await rateLimiter.resetRateLimit(testUserId)

      expect(db.delete).toHaveBeenCalled()
    })
  })
})
