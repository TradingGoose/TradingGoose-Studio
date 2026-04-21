import { db } from '@tradinggoose/db'
import { subscription, user } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ensureDefaultUserSubscription } from '@/lib/billing/core/subscription'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { BILLING_DISABLED_ERROR, getBillingGateState } from '@/lib/billing/settings'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import {
  getStripeCustomerDefaultPaymentMethodId,
  isDeletedStripeCustomer,
} from '@/lib/billing/stripe-customers'
import { BILLING_ACTIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { type BillingTierRecord, isFreeBillingTier } from '@/lib/billing/tiers'
import { handleSubscriptionCreated } from '@/lib/billing/webhooks/subscription'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PayAsYouGoActivationAPI')
const PAYG_ACTIVATION_LOCK_NAMESPACE = 4_126_091
const PAYG_ACTIVATION_ATTEMPT_METADATA_KEY = 'paygActivationAttemptId'

function isActivatablePersonalPaygTier(tier: BillingTierRecord | null | undefined): boolean {
  return Boolean(
    tier &&
      tier.status === 'active' &&
      tier.ownerType === 'user' &&
      tier.usageScope === 'individual' &&
      tier.seatMode === 'fixed' &&
      tier.stripeMonthlyPriceId &&
      isFreeBillingTier(tier)
  )
}

function normalizeSubscriptionMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return { ...metadata }
}

function getPaygActivationAttemptId(metadata: unknown): string | null {
  const activationAttemptId =
    normalizeSubscriptionMetadata(metadata)[PAYG_ACTIVATION_ATTEMPT_METADATA_KEY]

  return typeof activationAttemptId === 'string' ? activationAttemptId : null
}

function withPaygActivationAttemptId(metadata: unknown, activationAttemptId: string) {
  return {
    ...normalizeSubscriptionMetadata(metadata),
    [PAYG_ACTIVATION_ATTEMPT_METADATA_KEY]: activationAttemptId,
  }
}

function withoutPaygActivationAttemptId(metadata: unknown) {
  const { [PAYG_ACTIVATION_ATTEMPT_METADATA_KEY]: _ignored, ...rest } =
    normalizeSubscriptionMetadata(metadata)

  return Object.keys(rest).length > 0 ? rest : null
}

export async function POST() {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { billingEnabled } = await getBillingGateState()
    if (!billingEnabled) {
      return NextResponse.json({ error: BILLING_DISABLED_ERROR }, { status: 409 })
    }

    const stripe = requireStripeClient()
    const activationState = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PAYG_ACTIVATION_LOCK_NAMESPACE}, hashtext(${session.user.id}))`
      )

      const currentSubscription = await ensureDefaultUserSubscription(session.user.id)

      if (!isActivatablePersonalPaygTier(currentSubscription.tier)) {
        return NextResponse.json(
          { error: 'Current billing tier is not an inactive personal pay-as-you-go tier' },
          { status: 409 }
        )
      }

      if (currentSubscription.stripeSubscriptionId) {
        return NextResponse.json({
          success: true,
          status: 'already_active',
          stripeSubscriptionId: currentSubscription.stripeSubscriptionId,
        })
      }

      const userRows = await tx
        .select({ stripeCustomerId: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)

      const stripeCustomerId = userRows[0]?.stripeCustomerId ?? null
      if (!stripeCustomerId) {
        return NextResponse.json({ error: 'Stripe customer not found' }, { status: 409 })
      }

      const activationAttemptId =
        getPaygActivationAttemptId(currentSubscription.metadata) ?? crypto.randomUUID()

      if (!getPaygActivationAttemptId(currentSubscription.metadata)) {
        await tx
          .update(subscription)
          .set({
            metadata: withPaygActivationAttemptId(
              currentSubscription.metadata,
              activationAttemptId
            ),
          })
          .where(eq(subscription.id, currentSubscription.id))
      }

      return {
        activationAttemptId,
        currentSubscription,
        stripeCustomerId,
      }
    })

    if (activationState instanceof NextResponse) {
      return activationState
    }

    let customer

    try {
      customer = await stripe.customers.retrieve(activationState.stripeCustomerId)
    } catch (error) {
      logger.warn('Failed to retrieve Stripe customer during PAYG activation', {
        userId: session.user.id,
        stripeCustomerId: activationState.stripeCustomerId,
        error,
      })
      return NextResponse.json({ error: 'Stripe customer not found' }, { status: 409 })
    }

    if (isDeletedStripeCustomer(customer)) {
      return NextResponse.json({ error: 'Stripe customer not found' }, { status: 409 })
    }

    const existingStripeSubscriptions = await stripe.subscriptions.list({
      customer: activationState.stripeCustomerId,
      status: 'all',
      limit: 100,
    })

    const existingStripeSubscription = existingStripeSubscriptions.data.find(
      (candidate) =>
        candidate.metadata?.subscriptionId === activationState.currentSubscription.id &&
        BILLING_ACTIVE_SUBSCRIPTION_STATUSES.includes(
          candidate.status as (typeof BILLING_ACTIVE_SUBSCRIPTION_STATUSES)[number]
        )
    )

    if (existingStripeSubscription) {
      logger.warn('Recovered pre-existing Stripe subscription during PAYG activation retry', {
        userId: session.user.id,
        subscriptionId: activationState.currentSubscription.id,
        stripeCustomerId: activationState.stripeCustomerId,
        stripeSubscriptionId: existingStripeSubscription.id,
        stripeStatus: existingStripeSubscription.status,
      })
    }

    const defaultPaymentMethodId = getStripeCustomerDefaultPaymentMethodId(customer)
    if (!existingStripeSubscription && !defaultPaymentMethodId) {
      return NextResponse.json({ error: 'No default payment method on file' }, { status: 409 })
    }

    const stripeSubscription =
      existingStripeSubscription ??
      (await stripe.subscriptions
        .create(
          {
            customer: activationState.stripeCustomerId,
            default_payment_method: defaultPaymentMethodId ?? undefined,
            items: [{ price: activationState.currentSubscription.tier.stripeMonthlyPriceId! }],
            metadata: {
              userId: session.user.id,
              subscriptionId: activationState.currentSubscription.id,
              referenceId: session.user.id,
            },
            off_session: true,
            payment_behavior: 'error_if_incomplete',
          },
          {
            idempotencyKey: `payg-activate:${activationState.currentSubscription.id}:${activationState.activationAttemptId}`,
          }
        )
        .catch((error: unknown) => {
          if (error instanceof Error && 'type' in error) {
            const stripeError = error as Error & {
              code?: string
              message: string
              statusCode?: number
              type: string
            }

            logger.warn('Stripe rejected PAYG activation before subscription became active', {
              userId: session.user.id,
              subscriptionId: activationState.currentSubscription.id,
              stripeCustomerId: activationState.stripeCustomerId,
              type: stripeError.type,
              code: stripeError.code,
              message: stripeError.message,
              statusCode: stripeError.statusCode,
            })

            return { stripeError }
          }

          throw error
        }))

    if ('stripeError' in stripeSubscription) {
      await db
        .update(subscription)
        .set({
          metadata: withoutPaygActivationAttemptId(activationState.currentSubscription.metadata),
        })
        .where(eq(subscription.id, activationState.currentSubscription.id))

      return NextResponse.json(
        {
          error:
            stripeSubscription.stripeError.message ||
            'Failed to activate PAYG. Update your payment method and try again.',
          code: stripeSubscription.stripeError.code,
        },
        { status: stripeSubscription.stripeError.statusCode === 402 ? 402 : 409 }
      )
    }

    if (
      !BILLING_ACTIVE_SUBSCRIPTION_STATUSES.includes(
        stripeSubscription.status as (typeof BILLING_ACTIVE_SUBSCRIPTION_STATUSES)[number]
      )
    ) {
      logger.warn('Stripe returned unsupported PAYG activation status', {
        userId: session.user.id,
        subscriptionId: activationState.currentSubscription.id,
        stripeSubscriptionId: stripeSubscription.id,
        stripeStatus: stripeSubscription.status,
      })

      await db
        .update(subscription)
        .set({
          metadata: withoutPaygActivationAttemptId(activationState.currentSubscription.metadata),
        })
        .where(eq(subscription.id, activationState.currentSubscription.id))

      return NextResponse.json(
        {
          error: `Stripe returned unsupported subscription status "${stripeSubscription.status}" during PAYG activation.`,
        },
        { status: 409 }
      )
    }

    const currentPeriod = stripeSubscription.items.data[0]
    if (!currentPeriod) {
      throw new Error(`Stripe subscription ${stripeSubscription.id} has no subscription items`)
    }

    const periodStart = new Date(currentPeriod.current_period_start * 1000)
    const periodEnd = new Date(currentPeriod.current_period_end * 1000)
    const trialStart = stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : null
    const trialEnd = stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : null

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PAYG_ACTIVATION_LOCK_NAMESPACE}, hashtext(${session.user.id}))`
      )

      const currentSubscription = await ensureDefaultUserSubscription(session.user.id)

      if (currentSubscription.stripeSubscriptionId) {
        return
      }

      await handleSubscriptionCreated({
        id: currentSubscription.id,
        referenceType: currentSubscription.referenceType,
        referenceId: currentSubscription.referenceId,
        status: stripeSubscription.status,
        stripeSubscriptionId: stripeSubscription.id,
        seats: currentSubscription.seats,
        tier: activationState.currentSubscription.tier,
      })

      await syncSubscriptionUsageLimits({
        id: currentSubscription.id,
        referenceType: currentSubscription.referenceType,
        referenceId: currentSubscription.referenceId,
        seats: currentSubscription.seats,
        tier: activationState.currentSubscription.tier,
        status: stripeSubscription.status,
      })

      await tx
        .update(subscription)
        .set({
          plan: activationState.currentSubscription.tier.id,
          billingTierId: activationState.currentSubscription.tier.id,
          stripeCustomerId: activationState.stripeCustomerId,
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          trialStart,
          trialEnd,
          metadata: withoutPaygActivationAttemptId(currentSubscription.metadata),
        })
        .where(eq(subscription.id, currentSubscription.id))
    })

    logger.info('Activated personal pay-as-you-go subscription', {
      userId: session.user.id,
      subscriptionId: activationState.currentSubscription.id,
      stripeSubscriptionId: stripeSubscription.id,
      billingTierId: activationState.currentSubscription.tier.id,
    })

    return NextResponse.json({
      success: true,
      status: 'activated',
      stripeSubscriptionId: stripeSubscription.id,
    })
  } catch (error) {
    logger.error('Failed to activate personal pay-as-you-go subscription', {
      userId: session?.user?.id,
      error,
    })
    return NextResponse.json(
      { error: 'Failed to activate pay-as-you-go subscription' },
      { status: 500 }
    )
  }
}
