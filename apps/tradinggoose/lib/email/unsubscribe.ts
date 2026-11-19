import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { settings, user } from '@tradinggoose/db/schema'
import { eq, type SQL, sql } from 'drizzle-orm'
import { env } from '@/lib/env'

const preferenceKeys = {
  all: 'unsubscribeAll',
  marketing: 'unsubscribeMarketing',
  updates: 'unsubscribeUpdates',
  notifications: 'unsubscribeNotifications',
} as const

export type UnsubscribeAction = keyof typeof preferenceKeys
export type MailingList = Exclude<UnsubscribeAction, 'all'>
export type EmailPreferences = Partial<Record<(typeof preferenceKeys)[UnsubscribeAction], boolean>>

type Mailbox = Pick<typeof user.$inferSelect, 'id' | 'email'>
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function signUnsubscribeToken(mailbox: Mailbox, salt: string, emailType: string) {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(JSON.stringify([mailbox.id, mailbox.email, salt, emailType]))
    .digest()
}

export function generateUnsubscribeToken(mailbox: Mailbox, emailType: MailingList): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${signUnsubscribeToken(mailbox, salt, emailType).toString('hex')}:${emailType}`
}

export function verifyUnsubscribeToken(mailbox: Mailbox, token: string) {
  const parts = /^([a-f0-9]{32}):([a-f0-9]{64}):(marketing|updates|notifications)$/.exec(token)
  if (!parts) return null

  const [, salt, signature, emailType] = parts
  const valid = timingSafeEqual(
    Buffer.from(signature, 'hex'),
    signUnsubscribeToken(mailbox, salt, emailType)
  )
  return valid ? (emailType as MailingList) : null
}

export async function getEmailRecipient(where: SQL, tx?: Transaction) {
  const query = (tx ?? db)
    .select({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      preferences: sql<EmailPreferences | null>`${settings.emailPreferences}`,
    })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(where)
    .limit(1)
  const recipients = await (tx ? query.for('update', { of: user }) : query)
  return recipients.at(0)
}

export async function unsubscribeFromList(
  database: Pick<typeof db, 'insert'>,
  userId: string,
  list: UnsubscribeAction
) {
  const preferences = { [preferenceKeys[list]]: true }
  await database
    .insert(settings)
    .values({ id: userId, userId, emailPreferences: preferences })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        emailPreferences: sql`case when json_typeof(${settings.emailPreferences}) = 'object'
          then (${settings.emailPreferences}::jsonb || excluded.email_preferences::jsonb)::json
          else excluded.email_preferences end`,
        updatedAt: new Date(),
      },
    })
}

export function isUnsubscribed(
  preferences: EmailPreferences | null | undefined,
  list: MailingList
) {
  return !!(preferences?.unsubscribeAll || preferences?.[preferenceKeys[list]])
}
