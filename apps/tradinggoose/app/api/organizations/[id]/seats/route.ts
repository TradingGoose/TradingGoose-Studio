import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getOrganizationMemberRole } from '@/lib/billing/authorization'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { BILLING_DISABLED_ERROR, getBillingGateState } from '@/lib/billing/settings'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getStripeSeatPrice } from '@/lib/billing/stripe-portal'
import { getStripeSubscriptionPlanItem } from '@/lib/billing/subscriptions/utils'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { getOccupiedSeatCount, getSeatCapacity } from '@/lib/billing/validation/seat-management'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationSeatsAPI')

const updateSeatsSchema = z.object({
  seats: z.number().int().min(1, 'Minimum 1 seat required'),
  quoteRevision: z.string().min(1),
})

async function getBillingUserId() {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getBillingGateState()).billingEnabled) {
    return NextResponse.json({ error: BILLING_DISABLED_ERROR }, { status: 409 })
  }
  return session.user.id
}

async function getStripeSeatSubscription(stripeSubscriptionId: string, tier: BillingTierRecord) {
  const stripe = requireStripeClient()
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  const item = getStripeSubscriptionPlanItem(subscription, tier)
  if (
    subscription.status !== 'active' ||
    !item?.quantity ||
    item.price.recurring?.usage_type !== 'licensed'
  ) {
    return null
  }
  const { id, price, quantity } = item
  const seatPrice = subscription.currency === price.currency ? getStripeSeatPrice(price) : null
  return {
    stripe,
    itemId: id,
    quantity,
    quote: seatPrice && {
      ...seatPrice,
      quantity,
      revision: JSON.stringify([id, price.id, quantity]),
    },
  }
}

async function getSeatQuote(stripeSubscriptionId: string, tier: BillingTierRecord) {
  try {
    return (await getStripeSeatSubscription(stripeSubscriptionId, tier))?.quote ?? null
  } catch (error) {
    logger.warn('Failed to get Stripe seat price', { stripeSubscriptionId, error })
    return null
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getBillingUserId()
    if (userId instanceof NextResponse) return userId

    const { id: organizationId } = await params
    const body = await request.json()

    const validation = updateSeatsSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { seats: newSeatCount } = validation.data

    const role = await getOrganizationMemberRole(organizationId, userId)
    if (!role) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (role !== 'owner') {
      return NextResponse.json(
        { error: 'Forbidden - Organization owner access required' },
        { status: 403 }
      )
    }

    const orgSubscription = await getOrganizationSubscription(organizationId)

    if (!orgSubscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (
      orgSubscription.tier.ownerType !== 'organization' ||
      orgSubscription.tier.seatMode !== 'adjustable'
    ) {
      return NextResponse.json(
        { error: 'Seat changes are only available for adjustable-seat billing tiers' },
        { status: 400 }
      )
    }

    const seatCount = orgSubscription.tier.seatCount ?? 1
    const seatMaximum = orgSubscription.tier.seatMaximum

    if (newSeatCount < seatCount) {
      return NextResponse.json(
        { error: `Minimum ${seatCount} seat${seatCount === 1 ? '' : 's'} required` },
        { status: 400 }
      )
    }

    if (seatMaximum !== null && newSeatCount > seatMaximum) {
      return NextResponse.json(
        { error: `Maximum ${seatMaximum} seats allowed for this tier` },
        { status: 400 }
      )
    }

    const stripeSubscriptionId = orgSubscription.stripeSubscriptionId
    if (!stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'No Stripe subscription found for this organization' },
        { status: 400 }
      )
    }

    const occupiedSeats = await getOccupiedSeatCount(organizationId)

    if (newSeatCount < occupiedSeats) {
      return NextResponse.json(
        {
          error: `Cannot reduce seats below current occupied seat count (${occupiedSeats})`,
          occupiedSeats,
        },
        { status: 400 }
      )
    }

    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ seats: subscription.seats })
        .from(subscription)
        .where(
          and(
            eq(subscription.id, orgSubscription.id),
            eq(subscription.stripeSubscriptionId, stripeSubscriptionId)
          )
        )
        .for('update')
      if (!locked) return NextResponse.json({ error: 'Subscription changed' }, { status: 409 })
      const current = await getStripeSeatSubscription(stripeSubscriptionId, orgSubscription.tier)
      if (!current) {
        return NextResponse.json(
          { error: 'Stripe subscription has no active licensed seat item' },
          { status: 400 }
        )
      }
      const { stripe, itemId, quantity: currentSeats } = current
      if (!current.quote) {
        return NextResponse.json({ error: 'Seat price estimate is unavailable' }, { status: 409 })
      }

      const changed = current.quote.revision !== validation.data.quoteRevision
      const updatedSubscription =
        changed || newSeatCount === currentSeats
          ? null
          : await stripe.subscriptions.update(stripeSubscriptionId, {
              items: [{ id: itemId, quantity: newSeatCount }],
              proration_behavior: 'create_prorations',
            })

      const confirmedSeats = updatedSubscription ? newSeatCount : currentSeats
      if (locked.seats !== confirmedSeats) {
        await tx
          .update(subscription)
          .set({ seats: confirmedSeats })
          .where(eq(subscription.id, orgSubscription.id))
      }

      if (changed) {
        return NextResponse.json(
          { error: 'Organization seat quote changed. Review the updated quantity and price.' },
          { status: 409 }
        )
      }

      return { updatedSubscription, currentSeats }
    })
    if (result instanceof NextResponse) return result
    const { updatedSubscription, currentSeats } = result
    if (!updatedSubscription) {
      return NextResponse.json({
        success: true,
        message: 'No change in seat count',
        data: {
          seats: currentSeats,
          stripeSubscriptionId,
        },
      })
    }

    logger.info('Successfully updated seat count', {
      organizationId,
      stripeSubscriptionId,
      oldSeats: currentSeats,
      newSeats: newSeatCount,
      updatedBy: userId,
      prorationBehavior: 'create_prorations',
    })

    return NextResponse.json({
      success: true,
      message:
        newSeatCount > currentSeats
          ? `Added ${newSeatCount - currentSeats} seat(s). Your billing has been adjusted.`
          : `Removed ${currentSeats - newSeatCount} seat(s). You'll receive a prorated credit.`,
      data: {
        seats: newSeatCount,
        previousSeats: currentSeats,
        stripeSubscriptionId: updatedSubscription.id,
        stripeStatus: updatedSubscription.status,
      },
    })
  } catch (error) {
    const { id: organizationId } = await params

    if (error instanceof Error && 'type' in error) {
      const stripeError = error as any
      logger.error('Stripe error updating seats', {
        organizationId,
        type: stripeError.type,
        code: stripeError.code,
        message: stripeError.message,
      })

      return NextResponse.json(
        {
          error: stripeError.message || 'Failed to update seats in Stripe',
          code: stripeError.code,
        },
        { status: 400 }
      )
    }

    logger.error('Failed to update organization seats', {
      organizationId,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getBillingUserId()
    if (userId instanceof NextResponse) return userId

    const { id: organizationId } = await params

    const role = await getOrganizationMemberRole(organizationId, userId)
    if (!role) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const orgSubscription = await getOrganizationSubscription(organizationId)

    const [usedSeats, seatQuote] = await Promise.all([
      getOccupiedSeatCount(organizationId),
      orgSubscription?.stripeSubscriptionId &&
      orgSubscription.tier.seatMode === 'adjustable' &&
      role === 'owner'
        ? getSeatQuote(orgSubscription.stripeSubscriptionId, orgSubscription.tier)
        : null,
    ])
    return NextResponse.json({
      success: true,
      data: {
        organizationId,
        ...getSeatCapacity(orgSubscription, usedSeats),
        usedSeats,
        seatQuote,
      },
    })
  } catch (error) {
    const { id: organizationId } = await params
    logger.error('Failed to get organization seats', {
      organizationId,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
