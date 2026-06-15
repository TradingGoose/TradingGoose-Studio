import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { defaultLocale, isLocaleCode, LOCALE_COOKIE, type LocaleCode } from './utils'

const logger = createLogger('LocaleResolution')

type AuthenticatedLocaleResolver = (request: NextRequest) => Promise<LocaleCode | null>

type ResolveRequestLocaleOptions = {
  hasActiveSession: boolean
  resolveAuthenticatedLocale?: AuthenticatedLocaleResolver
}

type AcceptLanguageCandidate = {
  locale: LocaleCode
  quality: number
  index: number
}

export function getLocaleFromCookie(request: NextRequest): LocaleCode | null {
  const locale = request.cookies.get(LOCALE_COOKIE)?.value
  return locale && isLocaleCode(locale) ? locale : null
}

export function getLocaleFromAcceptLanguage(header: string | null): LocaleCode | null {
  if (!header) {
    return null
  }

  const candidates: AcceptLanguageCandidate[] = []

  header.split(',').forEach((entry, index) => {
    const [rawLanguageRange, ...rawParams] = entry
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)

    if (!rawLanguageRange || rawLanguageRange === '*') {
      return
    }

    const locale = rawLanguageRange.toLowerCase().split('-', 1)[0]
    if (!isLocaleCode(locale)) {
      return
    }

    const qualityParam = rawParams.find((param) => param.toLowerCase().startsWith('q='))
    const quality = qualityParam ? Number.parseFloat(qualityParam.slice(2)) : 1
    if (!Number.isFinite(quality) || quality <= 0) {
      return
    }

    candidates.push({ locale, quality, index })
  })

  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index)
  return candidates[0]?.locale ?? null
}

export function resolveAnonymousLocale(request: NextRequest): LocaleCode {
  return (
    getLocaleFromCookie(request) ??
    getLocaleFromAcceptLanguage(request.headers.get('accept-language')) ??
    defaultLocale
  )
}

export async function resolveAuthenticatedUserLocale(
  request: NextRequest
): Promise<LocaleCode | null> {
  try {
    const { getSession } = await import('@/lib/auth')
    const session = await getSession(request.headers, { disableCookieCache: true })
    const userId = session?.user?.id

    if (!userId) {
      return null
    }

    const [{ db, settings }, { eq }] = await Promise.all([
      import('@tradinggoose/db'),
      import('drizzle-orm'),
    ])
    const rows = await db
      .select({ preferredLocale: settings.preferredLocale })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    const preferredLocale = rows[0]?.preferredLocale
    return preferredLocale && isLocaleCode(preferredLocale) ? preferredLocale : null
  } catch (error) {
    logger.warn('Failed to resolve authenticated locale', { error })
    return null
  }
}

export async function resolveRequestLocale(
  request: NextRequest,
  options: ResolveRequestLocaleOptions
): Promise<LocaleCode> {
  if (options.hasActiveSession) {
    const authenticatedLocale = await (
      options.resolveAuthenticatedLocale ?? resolveAuthenticatedUserLocale
    )(request)

    if (authenticatedLocale) {
      return authenticatedLocale
    }
  }

  return resolveAnonymousLocale(request)
}
