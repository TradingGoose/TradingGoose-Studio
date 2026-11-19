import { db } from '@tradinggoose/db'
import { settings, user, waitlist } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { isLocaleCode, type LocaleCode, normalizeLocaleCode } from '@/i18n/utils'

export function normalizeEmailLocale(locale: string | null | undefined): LocaleCode {
  return normalizeLocaleCode(locale)
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function resolveEmailLocale({
  userId,
  email,
  fallbackLocale,
}: {
  userId?: string | null
  email?: string | null
  fallbackLocale?: string | null
}): Promise<LocaleCode> {
  if (userId) {
    const rows = await db
      .select({ preferredLocale: settings.preferredLocale })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    const preferredLocale = rows[0]?.preferredLocale
    if (preferredLocale && isLocaleCode(preferredLocale)) {
      return preferredLocale
    }
  }

  const normalizedEmail = email ? normalizeEmail(email) : ''
  if (normalizedEmail) {
    const userRows = await db
      .select({ preferredLocale: settings.preferredLocale })
      .from(user)
      .leftJoin(settings, eq(settings.userId, user.id))
      .where(eq(user.email, normalizedEmail))
      .limit(1)

    const userPreferredLocale = userRows[0]?.preferredLocale
    if (userPreferredLocale && isLocaleCode(userPreferredLocale)) {
      return userPreferredLocale
    }
    if (userRows.length > 0) {
      return normalizeEmailLocale(fallbackLocale)
    }

    const waitlistRows = await db
      .select({ preferredLocale: waitlist.preferredLocale })
      .from(waitlist)
      .where(eq(waitlist.email, normalizedEmail))
      .limit(1)

    const anonymousPreferredLocale = waitlistRows[0]?.preferredLocale
    if (anonymousPreferredLocale && isLocaleCode(anonymousPreferredLocale)) {
      return anonymousPreferredLocale
    }
  }

  return normalizeEmailLocale(fallbackLocale)
}
