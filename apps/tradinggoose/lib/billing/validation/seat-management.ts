import { db } from '@tradinggoose/db'
import { invitation, member } from '@tradinggoose/db/schema'
import { and, count, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import type { SubscriptionWithTier } from '@/lib/billing/tiers'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SeatManagement')
const noSeats = { canInvite: false, currentSeats: 0, maxSeats: 0, availableSeats: 0 }

interface SeatValidationResult {
  canInvite: boolean
  reason?: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
}

export async function getOccupiedSeatCount(organizationId: string): Promise<number> {
  const [memberCount, pendingInvitationCount] = await Promise.all([
    db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
    db
      .select({ count: count() })
      .from(invitation)
      .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending'))),
  ])

  return (memberCount[0]?.count ?? 0) + (pendingInvitationCount[0]?.count ?? 0)
}

export function getSeatCapacity(subscription: SubscriptionWithTier | null, usedSeats: number) {
  const maxSeats = subscription
    ? Math.max(subscription.seats || subscription.tier.seatCount || 1, 1)
    : 0
  return { maxSeats, availableSeats: Math.max(0, maxSeats - usedSeats) }
}

export async function validateSeatAvailability(
  organizationId: string,
  additionalSeats = 1
): Promise<SeatValidationResult> {
  try {
    const subscription = await getOrganizationSubscription(organizationId)

    if (!subscription) return { ...noSeats, reason: 'No active subscription found' }

    const currentSeats = await getOccupiedSeatCount(organizationId)

    if (subscription.tier.ownerType !== 'organization') {
      return {
        ...noSeats,
        reason: 'Seat limits are only available for organization subscriptions',
        currentSeats,
      }
    }

    const { maxSeats, availableSeats } = getSeatCapacity(subscription, currentSeats)
    const counts = { currentSeats, maxSeats, availableSeats }
    if (availableSeats >= additionalSeats) return { ...counts, canInvite: true }
    const reason =
      additionalSeats === 1
        ? `No available seats. Currently using ${currentSeats} of ${maxSeats} seats.`
        : `Not enough available seats. Need ${additionalSeats} seats, but only ${availableSeats} available.`
    return { ...counts, canInvite: false, reason }
  } catch (error) {
    logger.error('Failed to validate seat availability', { organizationId, additionalSeats, error })
    return { ...noSeats, reason: 'Failed to check seat availability' }
  }
}
