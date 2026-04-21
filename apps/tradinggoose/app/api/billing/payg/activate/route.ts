import { db } from '@tradinggoose/db'
import { subscription, user } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ensureDefaultUserSubscription } from '@/lib/billing/core/subscription'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { BILLING_DISABLED_ERROR, getBillingGateState } from '@/lib/billing/settings'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { BILLING_ACTIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { isFreeBillingTier, type BillingTierRecord } from '@/lib/billing/tiers'
import { syncSubscriptionBillingTierFromStripeSubscription } from '@/lib/billing/tiers/persistence'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PayAsYouGoActivationAPI')
const PAYG_ACTIVATION_LOCK_NAMESPACE = 4_126_091

function getDefaultPaymentMethodId(
  customer:
    | {
        invoice_settings?: {
          default_payment_method?:
            | string
            | {
                id?: string | null
              }
            | null
        } | null
      }
    | null
    | undefined
): string | null {
  const defaultPaymentMethod = customer?.invoice_settings?.default_payment_method

  if (typeof defaultPaymentMethod === 'string') {
    return defaultPaymentMethod
  }

  return defaultPaymentMethod?.id ?? null
}

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
    return await db.transaction(async (tx) => {
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

      let customer

      try {
        customer = await stripe.customers.retrieve(stripeCustomerId)
      } catch (error) {
        logger.warn('Failed to retrieve Stripe customer during PAYG activation', {
          userId: session.user.id,
          stripeCustomerId,
          error,
        })
        return NextResponse.json({ error: 'Stripe customer not found' }, { status: 409 })
      }

      if ('deleted' in customer) {
        return NextResponse.json({ error: 'Stripe customer not found' }, { status: 409 })
      }

      const defaultPaymentMethodId = getDefaultPaymentMethodId(customer)
      if (!defaultPaymentMethodId) {
        return NextResponse.json({ error: 'No default payment method on file' }, { status: 409 })
      }

      const activationAttemptId = crypto.randomUUID()
      const stripeSubscription = await stripe.subscriptions.create(
        {
          customer: stripeCustomerId,
          default_payment_method: defaultPaymentMethodId,
          items: [{ price: currentSubscription.tier.stripeMonthlyPriceId! }],
          metadata: {
            userId: session.user.id,
            subscriptionId: currentSubscription.id,
            referenceId: session.user.id,
          },
          off_session: true,
          payment_behavior: 'error_if_incomplete',
        },
        {
          idempotencyKey: `payg-activate:${currentSubscription.id}:${activationAttemptId}`,
        }
      ).catch((error: unknown) => {
        if (error instanceof Error && 'type' in error) {
          const stripeError = error as Error & {
            code?: string
            message: string
            statusCode?: number
            type: string
          }

          logger.warn('Stripe rejected PAYG activation before subscription became active', {
            userId: session.user.id,
            subscriptionId: currentSubscription.id,
            stripeCustomerId,
            type: stripeError.type,
            code: stripeError.code,
            message: stripeError.message,
            statusCode: stripeError.statusCode,
          })

          return NextResponse.json(
            {
              error:
                stripeError.message ||
                'Failed to activate PAYG. Update your payment method and try again.',
              code: stripeError.code,
            },
            { status: stripeError.statusCode === 402 ? 402 : 409 }
          )
        }

        throw error
      })

      if (stripeSubscription instanceof NextResponse) {
        return stripeSubscription
      }

      if (
        !BILLING_ACTIVE_SUBSCRIPTION_STATUSES.includes(
          stripeSubscription.status as (typeof BILLING_ACTIVE_SUBSCRIPTION_STATUSES)[number]
        )
      ) {
        logger.warn('Stripe returned unsupported PAYG activation status', {
          userId: session.user.id,
          subscriptionId: currentSubscription.id,
          stripeSubscriptionId: stripeSubscription.id,
          stripeStatus: stripeSubscription.status,
        })

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

      await tx
        .update(subscription)
        .set({
          plan: currentSubscription.tier.id,
          billingTierId: currentSubscription.tier.id,
          stripeCustomerId,
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          trialStart,
          trialEnd,
        })
        .where(eq(subscription.id, currentSubscription.id))

      await syncSubscriptionBillingTierFromStripeSubscription(
        currentSubscription.id,
        stripeSubscription
      )

      await syncSubscriptionUsageLimits({
        id: currentSubscription.id,
        referenceType: currentSubscription.referenceType,
        referenceId: currentSubscription.referenceId,
        seats: currentSubscription.seats,
        tier: currentSubscription.tier,
        status: stripeSubscription.status,
      })

      logger.info('Activated personal pay-as-you-go subscription', {
        userId: session.user.id,
        subscriptionId: currentSubscription.id,
        stripeSubscriptionId: stripeSubscription.id,
        billingTierId: currentSubscription.tier.id,
      })

      return NextResponse.json({
        success: true,
        status: 'activated',
        stripeSubscriptionId: stripeSubscription.id,
      })
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
