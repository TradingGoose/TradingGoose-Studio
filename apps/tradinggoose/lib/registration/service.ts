import { db } from '@tradinggoose/db'
import { invitation, waitlist, workspaceInvitation } from '@tradinggoose/db/schema'
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import {
  getEmailSubject,
  renderWaitlistApprovedEmail,
  renderWaitlistConfirmationEmail,
} from '@/components/emails/render-email'
import { sendBatchEmails, sendEmail, type TransactionalBatchEmail } from '@/lib/email/mailer'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getSystemSettingsRecord,
  resolveSystemSettingsFlags,
  type SystemSettingsReadStore,
  upsertSystemSettings,
} from '@/lib/system-settings/service'
import { getBaseUrl } from '@/lib/urls/utils'
import { localizeUrl, normalizeLocaleCode } from '@/i18n/utils'
import {
  DEFAULT_REGISTRATION_MODE,
  REGISTRATION_DISABLED_REASON,
  REGISTRATION_WAITLIST_REASON,
  type RegistrationMode,
  type WaitlistStatus,
} from './shared'

const logger = createLogger('RegistrationService')
const RESEND_BATCH_EMAIL_LIMIT = 100

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

export async function getRegistrationMode(
  store: SystemSettingsReadStore = db
): Promise<RegistrationMode> {
  const settings = await getSystemSettingsRecord(store)
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
  await upsertSystemSettings({ registrationMode })
}

async function getWaitlistEntryByEmail(email: string, store: SystemSettingsReadStore = db) {
  const [row] = await store.select().from(waitlist).where(waitlistEmailEquals(email)).limit(1)

  return row ?? null
}

export async function listWaitlistEntries() {
  return db.select().from(waitlist).orderBy(desc(waitlist.createdAt), desc(waitlist.id))
}

export async function addToWaitlist(email: string, locale?: string | null) {
  const normalizedEmail = normalizeEmail(email)
  const validation = quickValidateEmail(normalizedEmail)
  if (!validation.isValid) {
    throw new Error(validation.reason)
  }

  const preferredLocale = normalizeLocaleCode(locale)
  const existing = await getWaitlistEntryByEmail(normalizedEmail)
  if (existing) {
    if (existing.preferredLocale !== preferredLocale) {
      await db
        .update(waitlist)
        .set({
          preferredLocale,
          updatedAt: new Date(),
        })
        .where(eq(waitlist.id, existing.id))

      return {
        ...existing,
        preferredLocale,
      }
    }

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
    preferredLocale,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(waitlist).values(entry)
  await sendWaitlistConfirmationEmail(entry.email, preferredLocale)
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
    .select({
      id: waitlist.id,
      email: waitlist.email,
      preferredLocale: waitlist.preferredLocale,
      status: waitlist.status,
    })
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
    await sendWaitlistApprovalEmails(
      rowsToUpdate.map((row) => ({
        email: row.email,
        preferredLocale: row.preferredLocale,
      }))
    )
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

export async function getRegistrationDenialReason(
  email: string,
  store: SystemSettingsReadStore = db
) {
  const mode = await getRegistrationMode(store)
  const normalizedEmail = normalizeEmail(email)
  const denial = mode === 'disabled' ? REGISTRATION_DISABLED_REASON : REGISTRATION_WAITLIST_REASON
  if (!normalizedEmail) return denial
  if (mode === 'open' || (await hasPendingRegistrationInvitation(normalizedEmail, store)))
    return null
  if (mode === 'disabled') return denial
  return (await getWaitlistEntryByEmail(normalizedEmail, store))?.status === 'approved'
    ? null
    : denial
}

async function hasPendingRegistrationInvitation(
  normalizedEmail: string,
  store: SystemSettingsReadStore
) {
  const now = new Date()

  const [workspaceRow, organizationRow] = await Promise.all([
    store
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
    store
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

async function sendWaitlistConfirmationEmail(email: string, locale: string) {
  try {
    const html = await renderWaitlistConfirmationEmail(email, locale)
    const result = await sendEmail({
      to: email,
      subject: getEmailSubject('waitlist-confirmation', locale),
      html,
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

async function createWaitlistApprovalEmail(
  email: string,
  baseUrl: string,
  preferredLocale: string
): Promise<TransactionalBatchEmail | null> {
  try {
    const locale = normalizeLocaleCode(preferredLocale)
    const signupLink = localizeUrl(baseUrl, locale, `/signup?email=${encodeURIComponent(email)}`)
    return {
      to: email,
      subject: getEmailSubject('waitlist-approved', locale),
      html: await renderWaitlistApprovedEmail(email, signupLink, locale),
      emailType: 'transactional',
    }
  } catch (error) {
    logger.error('Failed to render waitlist approval email', {
      email,
      error,
    })
    return null
  }
}

async function sendWaitlistApprovalEmails(
  recipients: Array<{ email: string; preferredLocale: string }>
) {
  const baseUrl = getBaseUrl()

  for (let index = 0; index < recipients.length; index += RESEND_BATCH_EMAIL_LIMIT) {
    const batch = recipients.slice(index, index + RESEND_BATCH_EMAIL_LIMIT)
    const renderedEmails = await Promise.all(
      batch.map(({ email, preferredLocale }) =>
        createWaitlistApprovalEmail(email, baseUrl, preferredLocale)
      )
    )
    const batchEmails = renderedEmails.filter((email) => email !== null)

    if (batchEmails.length === 0) {
      continue
    }

    try {
      const result = await sendBatchEmails(batchEmails)

      if (!result.success) {
        logger.error('Failed to send waitlist approval email batch', {
          count: batchEmails.length,
          message: result.message,
        })
      }
    } catch (error) {
      logger.error('Failed to send waitlist approval email batch', {
        count: batchEmails.length,
        error,
      })
    }
  }
}
