import { db } from '@tradinggoose/db'
import { settings } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { defaultLocale, isLocaleCode, locales } from '@/i18n/utils'

const logger = createLogger('UserSettingsAPI')

const SettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  preferredLocale: z.enum(locales).optional(),
  telemetryEnabled: z.boolean().optional(),
  emailPreferences: z
    .object({
      unsubscribeAll: z.boolean().optional(),
      unsubscribeMarketing: z.boolean().optional(),
      unsubscribeUpdates: z.boolean().optional(),
      unsubscribeNotifications: z.boolean().optional(),
    })
    .optional(),
  billingUsageNotificationsEnabled: z.boolean().optional(),
})

const defaultSettings = {
  theme: 'system',
  preferredLocale: defaultLocale,
  telemetryEnabled: true,
  emailPreferences: {},
  billingUsageNotificationsEnabled: true,
}

function withPreferredLocaleCookie(response: NextResponse, locale: string | null | undefined) {
  if (locale && isLocaleCode(locale)) {
    response.cookies.set('NEXT_LOCALE', locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }

  return response
}

export async function GET() {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.info(`[${requestId}] Returning default settings for unauthenticated user`)
      return NextResponse.json({ data: defaultSettings }, { status: 200 })
    }

    const userId = session.user.id
    const result = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (!result.length) {
      return NextResponse.json({ data: defaultSettings }, { status: 200 })
    }

    const userSettings = result[0]

    const preferredLocale = userSettings.preferredLocale ?? defaultLocale

    return NextResponse.json(
      {
        data: {
          theme: userSettings.theme,
          preferredLocale,
          telemetryEnabled: userSettings.telemetryEnabled,
          emailPreferences: userSettings.emailPreferences ?? {},
          billingUsageNotificationsEnabled: userSettings.billingUsageNotificationsEnabled ?? true,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Settings fetch error`, error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    try {
      const validatedData = SettingsSchema.parse(body)

      await db
        .insert(settings)
        .values({
          id: nanoid(),
          userId,
          ...validatedData,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [settings.userId],
          set: {
            ...validatedData,
            updatedAt: new Date(),
          },
        })

      return withPreferredLocaleCookie(
        NextResponse.json({ success: true }, { status: 200 }),
        validatedData.preferredLocale
      )
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid settings data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid settings data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Settings update error`, error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
