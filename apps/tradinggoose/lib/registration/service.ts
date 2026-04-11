import { db } from '@tradinggoose/db'
import { invitation, waitlist, workspaceInvitation } from '@tradinggoose/db/schema'
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import {
  getEmailSubject,
  renderWaitlistApprovedEmail,
  renderWaitlistConfirmationEmail,
} from '@/components/emails/render-email'
import { sendEmail } from '@/lib/email/mailer'
import { getFromEmailAddress } from '@/lib/email/utils'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getSystemSettingsRecord,
  resolveSystemSettingsFlags,
  upsertSystemSettings,
} from '@/lib/system-settings/service'
import { getBaseUrl } from '@/lib/urls/utils'
import { DEFAULT_REGISTRATION_MODE, type RegistrationMode, type WaitlistStatus } from './shared'

const logger = createLogger('RegistrationService')

export type RegistrationEligibilityReason =
  | 'open'
  | 'invite'
  | 'approved_waitlist'
  | 'waitlist_required'
  | 'rejected_waitlist'
  | 'disabled'

export interface RegistrationEligibility {
  allowed: boolean
  mode: RegistrationMode
  reason: RegistrationEligibilityReason
}

export interface WaitlistRow {
  id: string
  email: string
  status: WaitlistStatus
  approvedAt: Date | null
  approvedByUserId: string | null
  rejectedAt: Date | null
  rejectedByUserId: string | null
  signedUpAt: Date | null
  userId: string | null
  createdAt: Date
  updatedAt: Date
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function waitlistEmailEquals(email: string) {
  return sql`lower(${waitlist.email}) = ${normalizeEmail(email)}`
}

function invitationEmailEquals(
  column: typeof invitation.email | typeof workspaceInvitation.email,
  email: string
) {
  return sql`lower(${column}) = ${normalizeEmail(email)}`
}

export async function getRegistrationMode(): Promise<RegistrationMode> {
  const settings = await getSystemSettingsRecord()
  return resolveSystemSettingsFlags(settings).registrationMode
}

export async function getRegistrationModeForRender(): Promise<RegistrationMode> {
  try {
    return await getRegistrationMode()
  } catch (error) {
    logger.warn('Falling back to default registration mode during render', {
      error,
    })
    return DEFAULT_REGISTRATION_MODE
  }
}

export async function setRegistrationMode(registrationMode: RegistrationMode) {
  const settings = await upsertSystemSettings({ registrationMode })
  return settings.registrationMode
}

export async function getWaitlistEntryByEmail(email: string): Promise<WaitlistRow | null> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return null
  }

  const [row] = await db
    .select()
    .from(waitlist)
    .where(waitlistEmailEquals(normalizedEmail))
    .limit(1)

  return (row as WaitlistRow | undefined) ?? null
}

export async function listWaitlistEntries(): Promise<WaitlistRow[]> {
  const rows = await db.select().from(waitlist).orderBy(desc(waitlist.createdAt), desc(waitlist.id))
  return rows as WaitlistRow[]
}

export async function addToWaitlist(email: string): Promise<WaitlistRow> {
  const normalizedEmail = normalizeEmail(email)
  const validation = quickValidateEmail(normalizedEmail)
  if (!validation.isValid) {
    throw new Error(validation.reason || 'Invalid email address')
  }

  const existing = await getWaitlistEntryByEmail(normalizedEmail)
  if (existing) {
    return existing
  }

  const now = new Date()
  const entry = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    status: 'pending' as const,
    approvedAt: null,
    approvedByUserId: null,
    rejectedAt: null,
    rejectedByUserId: null,
    signedUpAt: null,
    userId: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(waitlist).values(entry)
  await sendWaitlistConfirmationEmail(entry.email)
  return entry
}

export async function updateWaitlistStatuses(params: {
  ids: string[]
  status: Extract<WaitlistStatus, 'approved' | 'rejected'>
  reviewerUserId: string
}) {
  const ids = Array.from(new Set(params.ids.map((id) => id.trim()).filter(Boolean)))
  if (ids.length === 0) {
    throw new Error('Waitlist entry not found')
  }

  const rows = await db
    .select({ id: waitlist.id, email: waitlist.email, status: waitlist.status })
    .from(waitlist)
    .where(inArray(waitlist.id, ids))

  if (rows.length !== ids.length) {
    throw new Error('Waitlist entry not found')
  }

  if (rows.some((row) => row.status === 'signed_up')) {
    throw new Error('Signed up waitlist entries cannot be updated')
  }

  const rowsToUpdate = rows.filter((row) => row.status !== params.status)
  const idsToUpdate = rowsToUpdate.map((row) => row.id)

  if (idsToUpdate.length === 0) {
    return
  }

  const now = new Date()

  await db
    .update(waitlist)
    .set({
      status: params.status,
      approvedAt: params.status === 'approved' ? now : null,
      approvedByUserId: params.status === 'approved' ? params.reviewerUserId : null,
      rejectedAt: params.status === 'rejected' ? now : null,
      rejectedByUserId: params.status === 'rejected' ? params.reviewerUserId : null,
      updatedAt: now,
    })
    .where(inArray(waitlist.id, idsToUpdate))

  if (params.status === 'approved') {
    await Promise.all(rowsToUpdate.map((row) => sendWaitlistApprovalEmail(row.email)))
  }
}

export async function markWaitlistEntrySignedUp(email: string, userId: string) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return
  }

  const now = new Date()

  await db
    .update(waitlist)
    .set({
      status: 'signed_up',
      signedUpAt: now,
      userId,
      updatedAt: now,
    })
    .where(and(waitlistEmailEquals(normalizedEmail), ne(waitlist.status, 'signed_up')))
}

export async function getRegistrationEligibility(email: string): Promise<RegistrationEligibility> {
  const mode = await getRegistrationMode()
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return {
      allowed: false,
      mode,
      reason: mode === 'disabled' ? 'disabled' : 'waitlist_required',
    }
  }

  if (await hasPendingRegistrationInvitation(normalizedEmail)) {
    return { allowed: true, mode, reason: 'invite' }
  }

  if (mode === 'open') {
    return { allowed: true, mode, reason: 'open' }
  }

  if (mode === 'disabled') {
    return { allowed: false, mode, reason: 'disabled' }
  }

  const entry = await getWaitlistEntryByEmail(normalizedEmail)
  if (entry?.status === 'approved') {
    return { allowed: true, mode, reason: 'approved_waitlist' }
  }

  if (entry?.status === 'rejected') {
    return { allowed: false, mode, reason: 'rejected_waitlist' }
  }

  return { allowed: false, mode, reason: 'waitlist_required' }
}

export async function hasPendingRegistrationInvitation(email: string) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return false
  }

  const now = new Date()

  const [workspaceRow, organizationRow] = await Promise.all([
    db
      .select({ id: workspaceInvitation.id })
      .from(workspaceInvitation)
      .where(
        and(
          invitationEmailEquals(workspaceInvitation.email, normalizedEmail),
          eq(workspaceInvitation.status, 'pending'),
          gt(workspaceInvitation.expiresAt, now)
        )
      )
      .limit(1),
    db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          invitationEmailEquals(invitation.email, normalizedEmail),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now)
        )
      )
      .limit(1),
  ])

  return Boolean(workspaceRow[0] || organizationRow[0])
}

async function sendWaitlistConfirmationEmail(email: string) {
  try {
    const html = await renderWaitlistConfirmationEmail(email)
    const result = await sendEmail({
      to: email,
      subject: getEmailSubject('waitlist-confirmation'),
      html,
      from: getFromEmailAddress(),
      emailType: 'transactional',
    })

    if (!result.success) {
      logger.error('Failed to send waitlist confirmation email', {
        email,
        message: result.message,
      })
    }
  } catch (error) {
    logger.error('Failed to render or send waitlist confirmation email', {
      email,
      error,
    })
  }
}

async function sendWaitlistApprovalEmail(email: string) {
  try {
    const signupLink = `${getBaseUrl()}/signup?email=${encodeURIComponent(email)}`
    const html = await renderWaitlistApprovedEmail(email, signupLink)
    const result = await sendEmail({
      to: email,
      subject: getEmailSubject('waitlist-approved'),
      html,
      from: getFromEmailAddress(),
      emailType: 'transactional',
    })

    if (!result.success) {
      logger.error('Failed to send waitlist approval email', {
        email,
        message: result.message,
      })
    }
  } catch (error) {
    logger.error('Failed to render or send waitlist approval email', {
      email,
      error,
    })
  }
}
