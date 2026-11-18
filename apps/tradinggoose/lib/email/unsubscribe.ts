import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { settings, user } from '@tradinggoose/db/schema'
import { eq, type SQL, sql } from 'drizzle-orm'
import type { EmailType } from '@/lib/email/mailer'
import { env } from '@/lib/env'

interface EmailPreferences {
  unsubscribeAll?: boolean
  unsubscribeMarketing?: boolean
  unsubscribeUpdates?: boolean
  unsubscribeNotifications?: boolean
}

type Mailbox = Pick<typeof user.$inferSelect, 'id' | 'email' | 'mailboxVersion'>
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function signUnsubscribeToken(mailbox: Mailbox, salt: string, emailType: string) {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(JSON.stringify([mailbox.id, mailbox.email, mailbox.mailboxVersion, salt, emailType]))
    .digest()
}

export function generateUnsubscribeToken(
  mailbox: Mailbox,
  emailType: Exclude<EmailType, 'transactional'>
): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${signUnsubscribeToken(mailbox, salt, emailType).toString('hex')}:${emailType}`
}

export function verifyUnsubscribeToken(mailbox: Mailbox, token: string) {
  const parts = /^([a-f0-9]{32}):([a-f0-9]{64}):(marketing|updates|notifications)$/.exec(token)
  if (!parts) return false

  const [, salt, signature, emailType] = parts
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    signUnsubscribeToken(mailbox, salt, emailType)
  )
}

export async function getEmailRecipient(where: SQL, tx?: Transaction) {
  const query = (tx ?? db)
    .select({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      mailboxVersion: user.mailboxVersion,
      preferences: sql<EmailPreferences | null>`${settings.emailPreferences}`,
    })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(where)
    .limit(1)
  const recipients = await (tx ? query.for('update', { of: user }) : query)
  return recipients.at(0)
}

/**
 * Update user's email preferences
 */
export async function updateEmailPreferences(
  tx: Transaction,
  userId: string,
  preferences: EmailPreferences
) {
  await tx
    .insert(settings)
    .values({ id: userId, userId, emailPreferences: preferences })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        emailPreferences: sql`(${settings.emailPreferences}::jsonb || ${JSON.stringify(preferences)}::jsonb)::json`,
        updatedAt: new Date(),
      },
    })
}

/**
 * Check if user has unsubscribed from a specific email type
 */
export function isUnsubscribed(
  preferences: EmailPreferences | null | undefined,
  emailType: Exclude<EmailType, 'transactional'>
): boolean {
  if (preferences?.unsubscribeAll) return true

  switch (emailType) {
    case 'marketing':
      return preferences?.unsubscribeMarketing ?? false
    case 'updates':
      return preferences?.unsubscribeUpdates ?? false
    case 'notifications':
      return preferences?.unsubscribeNotifications ?? false
  }
}
