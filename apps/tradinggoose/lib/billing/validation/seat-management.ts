import { db } from '@tradinggoose/db'
import { invitation, member, user } from '@tradinggoose/db/schema'
import { and, count, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { quickValidateEmail } from '@/lib/email/validation'
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

/**
 * Validate and reserve seats for bulk invitations
 */
export async function validateBulkInvitations(
  organizationId: string,
  emailList: string[]
): Promise<{
  canInviteAll: boolean
  validEmails: string[]
  duplicateEmails: string[]
  existingMembers: string[]
  seatsNeeded: number
  seatsAvailable: number
  validationResult: SeatValidationResult
}> {
  try {
    const uniqueEmails = [...new Set(emailList)]
    const validEmails = uniqueEmails.filter(
      (email) => quickValidateEmail(email.trim().toLowerCase()).isValid
    )
    const duplicateEmails = emailList.filter((email, index) => emailList.indexOf(email) !== index)

    const existingMembers = await db
      .select({ userEmail: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId))

    const existingEmails = existingMembers.map((m) => m.userEmail)
    const newEmails = validEmails.filter((email) => !existingEmails.includes(email))

    const pendingInvitations = await db
      .select({ email: invitation.email })
      .from(invitation)
      .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))

    const pendingEmails = pendingInvitations.map((i) => i.email)
    const finalEmailsToInvite = newEmails.filter((email) => !pendingEmails.includes(email))

    const seatsNeeded = finalEmailsToInvite.length
    const validationResult = await validateSeatAvailability(organizationId, seatsNeeded)

    return {
      canInviteAll: validationResult.canInvite && finalEmailsToInvite.length > 0,
      validEmails: finalEmailsToInvite,
      duplicateEmails,
      existingMembers: validEmails.filter((email) => existingEmails.includes(email)),
      seatsNeeded,
      seatsAvailable: validationResult.availableSeats,
      validationResult,
    }
  } catch (error) {
    logger.error('Failed to validate bulk invitations', {
      organizationId,
      emailCount: emailList.length,
      error,
    })

    const validationResult: SeatValidationResult = {
      canInvite: false,
      reason: 'Validation failed',
      currentSeats: 0,
      maxSeats: 0,
      availableSeats: 0,
    }

    return {
      canInviteAll: false,
      validEmails: [],
      duplicateEmails: [],
      existingMembers: [],
      seatsNeeded: 0,
      seatsAvailable: 0,
      validationResult,
    }
  }
}
