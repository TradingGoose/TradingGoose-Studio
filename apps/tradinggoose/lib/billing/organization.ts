import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingOrganization')

type SubscriptionData = {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  status: string | null
  seats?: number | null
  tier?: BillingTierRecord | null
}

async function getUserOwnedOrganization(userId: string): Promise<string | null> {
  const existingMemberships = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.role, 'owner')))
    .limit(1)

  if (existingMemberships.length === 0) {
    return null
  }

  const [existingOrg] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, existingMemberships[0].organizationId))
    .limit(1)

  return existingOrg?.id || null
}

/**
 * Create a new organization and add user as owner
 */
async function createOrganizationWithOwner(
  userId: string,
  organizationName: string,
  organizationSlug: string,
  metadata: Record<string, any> = {}
): Promise<string> {
  const orgId = `org_${crypto.randomUUID()}`
  let sessionsUpdated = 0

  await db.transaction(async (tx) => {
    await tx.insert(schema.organization).values({
      id: orgId,
      name: organizationName,
      slug: organizationSlug,
      metadata,
    })

    await tx.insert(schema.member).values({
      id: crypto.randomUUID(),
      userId: userId,
      organizationId: orgId,
      role: 'owner',
    })

    const updatedSessions = await tx
      .update(schema.session)
      .set({ activeOrganizationId: orgId })
      .where(eq(schema.session.userId, userId))
      .returning({ id: schema.session.id })

    sessionsUpdated = updatedSessions.length
  })

  logger.info('Created organization with owner', {
    userId,
    organizationId: orgId,
    organizationName,
    sessionsUpdated,
  })

  return orgId
}

export async function createOrganizationForOrganizationTier(
  userId: string,
  userName?: string,
  userEmail?: string,
  organizationSlug?: string
): Promise<string> {
  try {
    const existingOrgId = await getUserOwnedOrganization(userId)
    if (existingOrgId) {
      return existingOrgId
    }

    const organizationName = userName || `${userEmail || 'User'}'s Team`
    const slug = organizationSlug || `${userId}-team-${Date.now()}`

    const orgId = await createOrganizationWithOwner(userId, organizationName, slug, {
      createdForOrganizationTier: true,
      originalUserId: userId,
    })

    logger.info('Created organization for organization tier', {
      userId,
      organizationId: orgId,
      organizationName,
    })

    return orgId
  } catch (error) {
    logger.error('Failed to create organization for organization tier', {
      userId,
      error,
    })
    throw error
  }
}

/**
 * Sync usage limits for subscription members
 * Updates usage limits for all users associated with the subscription
 */
export async function syncSubscriptionUsageLimits(subscription: SubscriptionData) {
  try {
    logger.info('Syncing subscription usage limits', {
      subscriptionId: subscription.id,
      referenceType: subscription.referenceType,
      referenceId: subscription.referenceId,
      billingTier: subscription.tier?.displayName,
    })

    if (subscription.referenceType === 'user') {
      await syncUsageLimitsFromSubscription(subscription.referenceId)

      logger.info('Synced usage limits for individual user subscription', {
        userId: subscription.referenceId,
        subscriptionId: subscription.id,
        billingTier: subscription.tier?.displayName,
      })
      return
    }

    const members = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, subscription.referenceId))

    if (members.length > 0) {
      for (const member of members) {
        try {
          await syncUsageLimitsFromSubscription(member.userId)
        } catch (memberError) {
          logger.error('Failed to sync usage limits for organization member', {
            userId: member.userId,
            organizationId: subscription.referenceId,
            subscriptionId: subscription.id,
            error: memberError,
          })
        }
      }

      logger.info('Synced usage limits for organization members', {
        organizationId: subscription.referenceId,
        memberCount: members.length,
        subscriptionId: subscription.id,
        billingTier: subscription.tier?.displayName,
      })
    }
  } catch (error) {
    logger.error('Failed to sync subscription usage limits', {
      subscriptionId: subscription.id,
      referenceType: subscription.referenceType,
      referenceId: subscription.referenceId,
      error,
    })
    throw error
  }
}
