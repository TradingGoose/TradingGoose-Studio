import { db } from '@tradinggoose/db'
import { invitation, member } from '@tradinggoose/db/schema'
import { and, count, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SeatManagement')

interface SeatValidationResult {
  canInvite: boolean
  reason?: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
}

export async function getSeatOccupancy(organizationId: string): Promise<{
  members: number
  pending: number
  occupied: number
}> {
  const [memberCount, pendingInvitationCount] = await Promise.all([
    db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
    db
      .select({ count: count() })
      .from(invitation)
      .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending'))),
  ])

  const members = memberCount[0]?.count || 0
  const pending = pendingInvitationCount[0]?.count || 0

  return {
    members,
    pending,
    occupied: members + pending,
  }
}

export async function getOccupiedSeatCount(organizationId: string): Promise<number> {
  const { occupied } = await getSeatOccupancy(organizationId)
  return occupied
}

/**
 * Validate if an organization can invite new members based on seat limits
 */
export async function validateSeatAvailability(
  organizationId: string,
  additionalSeats = 1
): Promise<SeatValidationResult> {
  try {
    // Get organization subscription directly (referenceId = organizationId)
    const subscription = await getOrganizationSubscription(organizationId)

    if (!subscription) {
      return {
        canInvite: false,
        reason: 'No active subscription found',
        currentSeats: 0,
        maxSeats: 0,
        availableSeats: 0,
      }
    }

    const { occupied: currentSeats } = await getSeatOccupancy(organizationId)

    if (subscription.tier.ownerType !== 'organization') {
      return {
        canInvite: false,
        reason: 'Seat limits are only available for organization subscriptions',
        currentSeats,
        maxSeats: 0,
        availableSeats: 0,
      }
    }

    const maxSeats = Math.max(subscription.seats || subscription.tier.seatCount || 1, 1)

    const availableSeats = Math.max(0, maxSeats - currentSeats)
    const canInvite = availableSeats >= additionalSeats

    const result: SeatValidationResult = {
      canInvite,
      currentSeats,
      maxSeats,
      availableSeats,
    }

    if (!canInvite) {
      if (additionalSeats === 1) {
        result.reason = `No available seats. Currently using ${currentSeats} of ${maxSeats} seats.`
      } else {
        result.reason = `Not enough available seats. Need ${additionalSeats} seats, but only ${availableSeats} available.`
      }
    }

    logger.debug('Seat validation result', {
      organizationId,
      additionalSeats,
      result,
    })

    return result
  } catch (error) {
    logger.error('Failed to validate seat availability', { organizationId, additionalSeats, error })
    return {
      canInvite: false,
      reason: 'Failed to check seat availability',
      currentSeats: 0,
      maxSeats: 0,
      availableSeats: 0,
    }
  }
}
