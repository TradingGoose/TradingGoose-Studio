import { db } from '@tradinggoose/db'
import { privateTierAccess, systemBillingTier } from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { ExecutionLimiter } from '@/services/queue/ExecutionLimiter'

const PRIVATE_TIER_ACCESS_RATE_LIMIT = 5
const rateLimiter = new ExecutionLimiter()

export async function checkPrivateTierAccessRateLimit(userId: string) {
  const result = await rateLimiter.checkRateLimitWithSubscription(
    userId,
    {
      referenceType: 'user',
      referenceId: userId,
      tier: {
        displayName: 'private-tier-access',
        syncRateLimitPerMinute: 0,
        asyncRateLimitPerMinute: 0,
        apiEndpointRateLimitPerMinute: PRIVATE_TIER_ACCESS_RATE_LIMIT,
      } as BillingTierRecord,
    },
    'api-endpoint',
    false,
    {
      scopeType: 'user',
      scopeId: `${userId}:private-tier-access`,
      organizationId: null,
      userId,
    },
    { enforceWithoutBilling: true, failClosedOnError: true }
  )

  return { ...result, limit: PRIVATE_TIER_ACCESS_RATE_LIMIT, userId }
}

export async function getGrantedPrivateBillingTiers(userId: string): Promise<BillingTierRecord[]> {
  return db
    .select({ tier: systemBillingTier })
    .from(privateTierAccess)
    .innerJoin(systemBillingTier, eq(privateTierAccess.billingTierId, systemBillingTier.id))
    .where(
      and(
        eq(privateTierAccess.userId, userId),
        eq(systemBillingTier.status, 'active'),
        eq(systemBillingTier.isPublic, false)
      )
    )
    .orderBy(asc(systemBillingTier.displayOrder))
    .then((rows) => rows.map(({ tier }) => tier))
}

export async function grantPrivateBillingTier(
  userId: string,
  accessCode: string
): Promise<BillingTierRecord | null> {
  const normalizedCode = accessCode.trim()
  if (!normalizedCode) {
    return null
  }

  const [tier] = await db
    .select()
    .from(systemBillingTier)
    .where(
      and(
        eq(systemBillingTier.accessCode, normalizedCode),
        eq(systemBillingTier.status, 'active'),
        eq(systemBillingTier.isPublic, false)
      )
    )
    .limit(1)

  if (!tier) {
    return null
  }

  await db
    .insert(privateTierAccess)
    .values({ userId, billingTierId: tier.id })
    .onConflictDoNothing()

  return tier
}

export async function hasPrivateBillingTierAccess(
  userId: string,
  billingTierId: string
): Promise<boolean> {
  const rows = await db
    .select({ userId: privateTierAccess.userId })
    .from(privateTierAccess)
    .where(
      and(eq(privateTierAccess.userId, userId), eq(privateTierAccess.billingTierId, billingTierId))
    )
    .limit(1)

  return rows.length > 0
}
