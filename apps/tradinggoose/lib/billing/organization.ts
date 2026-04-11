import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
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

const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const

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

export async function ensureOrganizationForOrganizationSubscription(
  subscription: SubscriptionData
): Promise<SubscriptionData> {
  if (subscription.tier?.ownerType !== 'organization') {
    return subscription
  }

  if (subscription.referenceId.startsWith('org_')) {
    return subscription
  }

  const userId = subscription.referenceId

  logger.info('Ensuring organization for organization-tier subscription', {
    subscriptionId: subscription.id,
    userId,
  })

  const memberships = await db
    .select({
      id: schema.member.id,
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
  const administrableMemberships = memberships.filter(
    (membership) => membership.role === 'owner' || membership.role === 'admin'
  )

  if (administrableMemberships.length > 0) {
    const existingOrgSubscriptions = await db
      .select({
        id: schema.subscription.id,
        organizationId: schema.subscription.referenceId,
      })
      .from(schema.subscription)
      .where(
        and(
          eq(schema.subscription.referenceType, 'organization'),
          inArray(
            schema.subscription.referenceId,
            administrableMemberships.map((membership) => membership.organizationId)
          ),
          inArray(schema.subscription.status, [...ENTITLED_SUBSCRIPTION_STATUSES])
        )
      )

    const organizationsWithActiveSubscriptions = new Set(
      existingOrgSubscriptions
        .filter((record) => record.id !== subscription.id)
        .map((record) => record.organizationId)
    )
    const membership = administrableMemberships.find(
      (candidate) => !organizationsWithActiveSubscriptions.has(candidate.organizationId)
    )

    if (!membership) {
      logger.error('Organization already has an active subscription', {
        userId,
        organizationIds: administrableMemberships.map((candidate) => candidate.organizationId),
        newSubscriptionId: subscription.id,
      })
      throw new Error('Organization already has an active subscription')
    }

    logger.info('User already owns/admins an organization, using it', {
      userId,
      organizationId: membership.organizationId,
    })

    await db.transaction(async (tx) => {
      await tx
        .update(schema.subscription)
        .set({
          referenceType: 'organization',
          referenceId: membership.organizationId,
        })
        .where(eq(schema.subscription.id, subscription.id))

      await tx
        .update(schema.session)
        .set({ activeOrganizationId: membership.organizationId })
        .where(eq(schema.session.userId, userId))
    })

    return {
      ...subscription,
      referenceType: 'organization',
      referenceId: membership.organizationId,
    }
  }

  if (memberships.length > 0) {
    logger.error('User is member of another organization and cannot create a paid org tier', {
      userId,
      existingOrganizationIds: memberships.map((membership) => membership.organizationId),
      subscriptionId: subscription.id,
    })
    throw new Error('User is already member of another organization')
  }

  const [userData] = await db
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)

  const organizationId = await createOrganizationForOrganizationTier(
    userId,
    userData?.name || undefined,
    userData?.email || undefined
  )

  await db
    .update(schema.subscription)
    .set({
      referenceType: 'organization',
      referenceId: organizationId,
    })
    .where(eq(schema.subscription.id, subscription.id))

  logger.info('Created organization and updated subscription reference', {
    subscriptionId: subscription.id,
    userId,
    organizationId,
  })

  return {
    ...subscription,
    referenceType: 'organization',
    referenceId: organizationId,
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
