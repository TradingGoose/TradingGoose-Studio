import { db } from '@tradinggoose/db'
import { member, subscription } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { BILLING_DISABLED_ERROR, getBillingGateState } from '@/lib/billing/settings'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getStripeSubscriptionPlanItem } from '@/lib/billing/subscriptions/utils'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { getOccupiedSeatCount, getSeatCapacity } from '@/lib/billing/validation/seat-management'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationSeatsAPI')

const updateSeatsSchema = z.object({
  seats: z.number().int().min(1, 'Minimum 1 seat required'),
})

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
  const interval = price.recurring?.interval
  const amount = price.unit_amount_decimal ?? price.unit_amount
  const seatPrice =
    subscription.currency === 'usd' &&
    price.currency === 'usd' &&
    price.billing_scheme === 'per_unit' &&
    !price.transform_quantity &&
    price.recurring?.interval_count === 1 &&
    (interval === 'month' || interval === 'year') &&
    amount != null
      ? { amountUsd: Number(amount) / 100, interval }
      : null
  return {
    stripe,
    itemId: id,
    quantity,
    seatPrice,
  }
}

async function getSeatPrice(stripeSubscriptionId: string, tier: BillingTierRecord) {
  try {
    return (await getStripeSeatSubscription(stripeSubscriptionId, tier))?.seatPrice ?? null
  } catch (error) {
    logger.warn('Failed to get Stripe seat price', { stripeSubscriptionId, error })
    return null
  }
}

/**
 * PUT /api/organizations/[id]/seats
 * Update organization seat count using Stripe's subscription.update API.
 * This is the recommended approach for per-seat billing changes.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!(await getBillingGateState()).billingEnabled) {
      return NextResponse.json({ error: BILLING_DISABLED_ERROR }, { status: 409 })
    }

    const { id: organizationId } = await params
    const body = await request.json()

    const validation = updateSeatsSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { seats: newSeatCount } = validation.data

    const memberEntry = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (memberEntry.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (memberEntry[0].role !== 'owner') {
      return NextResponse.json(
        { error: 'Forbidden - Organization owner access required' },
        { status: 403 }
      )
    }

    // Get the organization's subscription
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

    if (!orgSubscription.stripeSubscriptionId) {
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

    const current = await getStripeSeatSubscription(
      orgSubscription.stripeSubscriptionId,
      orgSubscription.tier
    )
    if (!current) {
      return NextResponse.json(
        { error: 'Stripe subscription has no active licensed seat item' },
        { status: 400 }
      )
    }
    const { stripe, itemId, quantity: currentSeats } = current
    if (newSeatCount !== currentSeats && !current.seatPrice) {
      return NextResponse.json({ error: 'Seat price estimate is unavailable' }, { status: 409 })
    }

    const updatedSubscription =
      newSeatCount === currentSeats
        ? null
        : await stripe.subscriptions.update(orgSubscription.stripeSubscriptionId, {
            items: [{ id: itemId, quantity: newSeatCount }],
            proration_behavior: 'create_prorations',
          })

    if (updatedSubscription || orgSubscription.seats !== newSeatCount) {
      await db
        .update(subscription)
        .set({ seats: newSeatCount })
        .where(eq(subscription.id, orgSubscription.id))
    }

    if (!updatedSubscription) {
      return NextResponse.json({
        success: true,
        message: 'No change in seat count',
        data: {
          seats: currentSeats,
          stripeSubscriptionId: orgSubscription.stripeSubscriptionId,
        },
      })
    }

    logger.info('Successfully updated seat count', {
      organizationId,
      stripeSubscriptionId: orgSubscription.stripeSubscriptionId,
      oldSeats: currentSeats,
      newSeats: newSeatCount,
      updatedBy: session.user.id,
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

    // Handle Stripe-specific errors
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

/**
 * GET /api/organizations/[id]/seats
 * Get current seat information for an organization
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!(await getBillingGateState()).billingEnabled) {
      return NextResponse.json({ error: BILLING_DISABLED_ERROR }, { status: 409 })
    }

    const { id: organizationId } = await params

    // Verify user has access to this organization
    const memberEntry = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (memberEntry.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const orgSubscription = await getOrganizationSubscription(organizationId)

    const [usedSeats, seatPrice] = await Promise.all([
      getOccupiedSeatCount(organizationId),
      orgSubscription?.stripeSubscriptionId &&
      orgSubscription.tier.seatMode === 'adjustable' &&
      memberEntry[0].role === 'owner'
        ? getSeatPrice(orgSubscription.stripeSubscriptionId, orgSubscription.tier)
        : null,
    ])
    return NextResponse.json({
      success: true,
      data: {
        organizationId,
        ...getSeatCapacity(orgSubscription, usedSeats),
        usedSeats,
        seatPrice,
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
