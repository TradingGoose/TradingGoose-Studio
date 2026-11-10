import {
  FinancialPolicyError,
  type FinancialTransaction,
  financialNamespace,
  lockFinancialRoots,
  periodKey,
  readFinancialReceipt,
} from '@tradinggoose/billing'
import { compareMoney, type DecimalAmount, maxMoney, monetary } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import { idempotencyKey, member, subscription, user, userStats } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { rotateSubscriptionAfterMutation } from '@/lib/billing/financial-subscriptions'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { BILLING_ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { BillingReference, SubscriptionWithTier } from '@/lib/billing/tiers'
import {
  getSubscriptionUsageAllowanceUsd,
  getTierDisplayName,
  hydrateSubscriptionsWithTiers,
  requireDefaultBillingTier,
  selectEffectiveSubscription,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('SubscriptionCore')

export class MissingBillingSubscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingBillingSubscriptionError'
  }
}

export interface PersonalBillingSnapshot {
  subscription: SubscriptionWithTier | null
  tier: BillingTierSummary
  currentPeriodCost: DecimalAmount
  limit: DecimalAmount | null
  isExceeded: boolean
}

export function getSubscribedPersonalUsageMinimumLimit(params: {
  subscription: SubscriptionWithTier | null
  grantedOnboardingAllowanceUsd: DecimalAmount | null | undefined
}): DecimalAmount {
  if (!params.subscription) return '0'
  const subscriptionLimit = getSubscriptionUsageAllowanceUsd(params.subscription)
  return params.subscription.tier.isDefault
    ? maxMoney(subscriptionLimit, monetary(params.grantedOnboardingAllowanceUsd))
    : subscriptionLimit
}
export function getConfiguredPersonalUsageLimit(
  customUsageLimit: DecimalAmount | null | undefined,
  minimumLimit: DecimalAmount
): DecimalAmount {
  return customUsageLimit === null || customUsageLimit === undefined
    ? monetary(minimumLimit)
    : maxMoney(monetary(customUsageLimit), monetary(minimumLimit))
}

/**
 * Get the active subscription that currently governs a billing reference.
 */
export async function getActiveSubscriptionForReference(
  reference: BillingReference,
  dbClient: Pick<typeof db, 'insert' | 'select'> = db
): Promise<SubscriptionWithTier | null> {
  const rows = await dbClient
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, reference.referenceType),
        eq(subscription.referenceId, reference.referenceId),
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
      )
    )

  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(rows, dbClient)
  const effectiveSubscription = selectEffectiveSubscription(hydratedSubscriptions)

  return effectiveSubscription
}

export async function requireActiveSubscriptionForReference(
  reference: BillingReference
): Promise<SubscriptionWithTier> {
  const activeSubscription = await getActiveSubscriptionForReference(reference)

  if (!activeSubscription?.tier) {
    throw new MissingBillingSubscriptionError(
      `No active subscription found for ${reference.referenceType} ${reference.referenceId}`
    )
  }

  return activeSubscription
}

export async function getSubscriptionByStripeSubscriptionId(
  stripeSubscriptionId: string
): Promise<SubscriptionWithTier | null> {
  const rows = await db
    .select()
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)

  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(rows)
  return hydratedSubscriptions[0] ?? null
}

export async function getEffectiveSubscription(
  userId: string
): Promise<SubscriptionWithTier | null> {
  const personalSubscription = await getPersonalEffectiveSubscription(userId)
  return personalSubscription
}

export async function getPersonalEffectiveSubscription(
  userId: string,
  dbClient: Pick<typeof db, 'select'> = db
): Promise<SubscriptionWithTier | null> {
  const personalSubs = await dbClient
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, 'user'),
        eq(subscription.referenceId, userId),
        inArray(subscription.status, [...BILLING_ENTITLED_SUBSCRIPTION_STATUSES])
      )
    )
  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(personalSubs, dbClient)
  return selectEffectiveSubscription(hydratedSubscriptions)
}

export async function ensureDefaultUserSubscription(
  userId: string,
  transaction?: FinancialTransaction
): Promise<SubscriptionWithTier> {
  const initialize = async (tx: FinancialTransaction): Promise<SubscriptionWithTier> => {
    const root = { type: 'user' as const, id: userId }
    await lockFinancialRoots(tx, [root])
    const existing = await getPersonalEffectiveSubscription(userId, tx)
    if (existing) return existing
    const defaultTier = await requireDefaultBillingTier(tx)
    const head = await readFinancialReceipt(tx, financialNamespace(root), 'period-head')
    let previous: typeof subscription.$inferSelect | undefined
    if (!head) {
      const [ledger] = await tx
        .select({
          total: userStats.totalCost,
          current: userStats.currentPeriodCost,
          previous: userStats.lastPeriodCost,
        })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1)
      const [evidence] = await tx
        .select({ key: idempotencyKey.key })
        .from(idempotencyKey)
        .where(eq(idempotencyKey.namespace, financialNamespace(root)))
        .limit(1)
      if (
        evidence ||
        (ledger &&
          [ledger.total, ledger.current, ledger.previous].some((value) => monetary(value) !== '0'))
      )
        throw new FinancialPolicyError(
          'Original financial basis must be preserved before default provisioning'
        )
    }
    if (head) {
      if (head.recordType !== 'period-head')
        throw new FinancialPolicyError('Original financial period identity is invalid')
      if (head.current) {
        const basis = await readFinancialReceipt(
          tx,
          financialNamespace(root),
          periodKey(head.current)
        )
        if (!basis || basis.recordType !== 'period' || !basis.closing)
          throw new FinancialPolicyError(
            'Verified original closing basis required before default restoration'
          )
        ;[previous] = await tx
          .select()
          .from(subscription)
          .where(eq(subscription.id, head.current.subscriptionId))
          .limit(1)
        if (!previous || previous.referenceType !== 'user' || previous.referenceId !== userId)
          throw new FinancialPolicyError('Original financial subscription must remain retained')
      }
    }
    const [created] = await tx
      .insert(subscription)
      .values({
        id: crypto.randomUUID(),
        plan: defaultTier.id,
        billingTierId: defaultTier.id,
        referenceType: 'user',
        referenceId: userId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        status: 'active',
        periodStart: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        seats: null,
        trialStart: null,
        trialEnd: null,
        metadata: { source: 'default-tier' },
      })
      .returning()
    if (!created) throw new FinancialPolicyError('Default subscription creation failed')
    if (previous && head?.recordType === 'period-head' && head.current)
      await rotateSubscriptionAfterMutation(tx, previous, created, true, head.current)
    return { ...created, tier: defaultTier }
  }
  return transaction ? initialize(transaction) : db.transaction(initialize)
}

export async function getPersonalBillingSnapshot(userId: string): Promise<PersonalBillingSnapshot> {
  try {
    const [{ billingEnabled }, subscription, statsRecords] = await Promise.all([
      getResolvedBillingSettings(),
      getEffectiveSubscription(userId),
      db
        .select({
          currentPeriodCost: userStats.currentPeriodCost,
          totalCost: userStats.totalCost,
          customUsageLimit: userStats.customUsageLimit,
          grantedOnboardingAllowanceUsd: userStats.grantedOnboardingAllowanceUsd,
        })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1),
    ])

    const stats = statsRecords[0]
    if (!stats) throw new FinancialPolicyError('Original financial ledger missing')
    const currentPeriodCost = monetary(stats.currentPeriodCost)

    if (!billingEnabled) {
      return {
        subscription: null,
        tier: toBillingTierSummary(null),
        currentPeriodCost,
        limit: null,
        isExceeded: false,
      }
    }

    if (!subscription) {
      throw new Error(`No active personal subscription found for billed user ${userId}`)
    }

    const minimumLimit = getSubscribedPersonalUsageMinimumLimit({
      subscription,
      grantedOnboardingAllowanceUsd: stats?.grantedOnboardingAllowanceUsd,
    })
    const limit = getConfiguredPersonalUsageLimit(stats?.customUsageLimit, minimumLimit)

    return {
      subscription,
      tier: toBillingTierSummary(subscription.tier),
      currentPeriodCost,
      limit,
      isExceeded: compareMoney(currentPeriodCost, limit) >= 0,
    }
  } catch (error) {
    logger.error('Error getting personal billing snapshot', { error, userId })
    throw error
  }
}

/**
 * Send welcome email for active billing tiers
 */
export async function sendBillingTierWelcomeEmail(subscriptionRecord: {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  tier?: SubscriptionWithTier['tier'] | null
}): Promise<void> {
  try {
    const hydratedSubscription = subscriptionRecord?.tier
      ? subscriptionRecord
      : (
          await hydrateSubscriptionsWithTiers(
            await db
              .select()
              .from(subscription)
              .where(eq(subscription.id, subscriptionRecord.id))
              .limit(1)
          )
        )[0]
    const tier = hydratedSubscription?.tier
    if (!tier) {
      return
    }

    const { getPlanWelcomeSubject, renderPlanWelcomeEmail } = await import(
      '@/components/emails/render-email'
    )
    const { sendEmail } = await import('@/lib/email/mailer')
    const { resolveEmailLocale } = await import('@/lib/email/locale')
    const baseUrl = getBaseUrl()

    if (hydratedSubscription.referenceType === 'user') {
      const users = await db
        .select({ id: user.id, email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, hydratedSubscription.referenceId))
        .limit(1)

      if (users.length === 0 || !users[0].email) {
        return
      }

      const locale = await resolveEmailLocale({ userId: users[0].id, email: users[0].email })
      const html = await renderPlanWelcomeEmail({
        planName: getTierDisplayName(tier),
        userName: users[0].name || undefined,
        loginLink: `${baseUrl}/login`,
        locale,
      })

      await sendEmail({
        to: users[0].email,
        subject: getPlanWelcomeSubject(getTierDisplayName(tier), locale),
        html,
        emailType: 'updates',
      })

      logger.info('Billing tier welcome email sent successfully', {
        userId: hydratedSubscription.referenceId,
        email: users[0].email,
        billingTier: tier.displayName,
      })
      return
    }

    const recipients = await db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, hydratedSubscription.referenceId))

    for (const recipient of recipients) {
      if (!recipient.email) {
        continue
      }

      const locale = await resolveEmailLocale({ userId: recipient.id, email: recipient.email })
      const html = await renderPlanWelcomeEmail({
        planName: getTierDisplayName(tier),
        userName: recipient.name || undefined,
        loginLink: `${baseUrl}/login`,
        locale,
      })

      await sendEmail({
        to: recipient.email,
        subject: getPlanWelcomeSubject(getTierDisplayName(tier), locale),
        html,
        emailType: 'updates',
      })
    }
  } catch (error) {
    logger.error('Failed to send billing tier welcome email', {
      error,
      subscriptionId: subscriptionRecord.id,
      billingTier: subscriptionRecord.tier?.displayName,
    })
    throw error
  }
}
