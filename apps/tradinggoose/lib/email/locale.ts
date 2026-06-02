import { db } from '@tradinggoose/db'
import { emailRecipientPreference, settings, user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { defaultLocale, isLocaleCode, type LocaleCode } from '@/i18n/utils'

export function normalizeEmailLocale(locale: string | null | undefined): LocaleCode {
  return locale && isLocaleCode(locale) ? locale : defaultLocale
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function persistAuthenticatedPreferredLocale(userId: string, locale: string) {
  const preferredLocale = normalizeEmailLocale(locale)

  await db
    .insert(settings)
    .values({
      id: nanoid(),
      userId,
      preferredLocale,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        preferredLocale,
        updatedAt: new Date(),
      },
    })

  return preferredLocale
}

export async function persistAnonymousEmailLocale(email: string, locale: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return defaultLocale
  }

  const preferredLocale = normalizeEmailLocale(locale)

  await db
    .insert(emailRecipientPreference)
    .values({
      email: normalizedEmail,
      preferredLocale,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emailRecipientPreference.email,
      set: {
        preferredLocale,
        updatedAt: new Date(),
      },
    })

  return preferredLocale
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

    const anonymousRows = await db
      .select({ preferredLocale: emailRecipientPreference.preferredLocale })
      .from(emailRecipientPreference)
      .where(eq(emailRecipientPreference.email, normalizedEmail))
      .limit(1)

    const anonymousPreferredLocale = anonymousRows[0]?.preferredLocale
    if (anonymousPreferredLocale && isLocaleCode(anonymousPreferredLocale)) {
      return anonymousPreferredLocale
    }
  }

  return normalizeEmailLocale(fallbackLocale)
}
