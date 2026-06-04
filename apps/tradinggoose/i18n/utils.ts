import { createTranslator } from 'next-intl'
import { getBaseUrl } from '@/lib/urls/utils'
import { type AppLocale, defaultLocale, isLocaleCode, locales } from './routing'

export type LocaleCode = AppLocale
export type LocaleInput = LocaleCode | string | null | undefined

export { defaultLocale, isLocaleCode, locales }

export const SITE_BASE_URL = getBaseUrl()
export const CANONICAL_CALLBACK_PATH_HEADER = 'x-tradinggoose-callback-path'
const LOCALE_DISPLAY_NAMES: Record<LocaleCode, string> = {
  en: 'English',
  es: 'Español',
  zh: '简体中文',
}
const DOCS_BASE_URL = 'https://docs.tradinggoose.ai'

const OPEN_GRAPH_LOCALE_MAP: Record<LocaleCode, string> = {
  en: 'en_US',
  es: 'es_ES',
  zh: 'zh_CN',
}

export function normalizeLocaleCode(locale: LocaleInput): LocaleCode {
  return locale && isLocaleCode(locale) ? locale : defaultLocale
}

export function getLocaleDisplayName(locale: LocaleCode) {
  return LOCALE_DISPLAY_NAMES[locale]
}

export function stripLocaleFromPathname(pathname: string): {
  locale: LocaleCode
  pathname: string
} {
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]

  if (firstSegment && isLocaleCode(firstSegment)) {
    const stripped = `/${segments.slice(1).join('/')}`.replace(/\/+$/, '')
    return {
      locale: firstSegment,
      pathname: stripped || '/',
    }
  }

  return {
    locale: defaultLocale,
    pathname: pathname || '/',
  }
}

function prefixLocalePathname(locale: LocaleCode, pathname: string) {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')

  if (locale === defaultLocale) {
    return normalized
  }

  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

function assertCanonicalInternalPathname(pathname: string) {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    throw new Error(`Expected a canonical internal pathname, received "${pathname}"`)
  }

  const firstSegment = pathname.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0]
  if (firstSegment && isLocaleCode(firstSegment)) {
    throw new Error(`Expected an unlocalized internal pathname, received "${pathname}"`)
  }
}

export function normalizeCallbackUrl(
  href: string | null | undefined,
  currentOrigin?: string
): string | null {
  if (!href) {
    return null
  }

  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith('//')) {
    return null
  }

  if (trimmedHref.startsWith('/')) {
    const parsedUrl = new URL(trimmedHref, 'http://tradinggoose.local')
    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
  }

  if (!currentOrigin) {
    return null
  }

  try {
    const parsedUrl = new URL(trimmedHref)

    if (parsedUrl.origin !== currentOrigin) {
      return null
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
  } catch {
    return null
  }
}

export function localizeUrl(baseUrl: string, locale: LocaleInput, pathname: string) {
  assertCanonicalInternalPathname(pathname)
  return `${baseUrl.replace(/\/+$/, '')}${prefixLocalePathname(normalizeLocaleCode(locale), pathname)}`
}

export function localizeSiteUrl(locale: LocaleCode, pathname: string) {
  return localizeUrl(getBaseUrl(), locale, pathname)
}

export function localizeDocsUrl(locale: LocaleCode, pathname = '/') {
  return localizeUrl(DOCS_BASE_URL, locale, pathname)
}

export function getOpenGraphLocale(locale: LocaleCode) {
  return OPEN_GRAPH_LOCALE_MAP[locale]
}

export function buildLocalizedAlternates(locale: LocaleCode, pathname: string) {
  const baseUrl = getBaseUrl()

  return {
    canonical: localizeUrl(baseUrl, locale, pathname),
    languages: Object.fromEntries([
      ...locales.map(
        (candidate) => [candidate, localizeUrl(baseUrl, candidate, pathname)] as const
      ),
      ['x-default', localizeUrl(baseUrl, defaultLocale, pathname)] as const,
    ]),
  }
}

export function formatTemplate(
  template: string,
  values: Record<string, string | number | Date>,
  locale: LocaleCode = defaultLocale
) {
  let formatError: unknown
  const translator = createTranslator({
    locale,
    messages: { value: template },
    onError(error) {
      formatError = error
    },
  })
  const formatted = translator('value', values)

  if (formatError) {
    throw formatError
  }

  return formatted
}
