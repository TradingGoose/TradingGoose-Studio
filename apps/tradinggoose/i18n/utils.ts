export type LocaleCode = 'en' | 'es' | 'zh'

export const locales = ['en', 'es', 'zh'] as const
export const defaultLocale: LocaleCode = 'en'
export const SITE_BASE_URL = 'https://tradinggoose.ai'
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

export function isLocaleCode(value: string): value is LocaleCode {
  return (locales as readonly string[]).includes(value)
}

export function getLocaleDisplayName(locale: LocaleCode) {
  return LOCALE_DISPLAY_NAMES[locale]
}

export function stripLocaleFromPathname(pathname: string): { locale: LocaleCode; pathname: string } {
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
    const { pathname } = stripLocaleFromPathname(parsedUrl.pathname)
    return `${pathname}${parsedUrl.search}${parsedUrl.hash}`
  }

  if (!currentOrigin) {
    return null
  }

  try {
    const parsedUrl = new URL(trimmedHref)

    if (parsedUrl.origin !== currentOrigin) {
      return null
    }

    const { pathname } = stripLocaleFromPathname(parsedUrl.pathname)
    return `${pathname}${parsedUrl.search}${parsedUrl.hash}`
  } catch {
    return null
  }
}

export function localizeUrl(baseUrl: string, locale: LocaleCode, pathname: string) {
  return `${baseUrl}${prefixLocalePathname(locale, pathname)}`
}

export function localizeSiteUrl(locale: LocaleCode, pathname: string) {
  return localizeUrl(SITE_BASE_URL, locale, pathname)
}

export function localizeDocsUrl(locale: LocaleCode, pathname = '/') {
  return localizeUrl(DOCS_BASE_URL, locale, pathname)
}

export function getOpenGraphLocale(locale: LocaleCode) {
  return OPEN_GRAPH_LOCALE_MAP[locale]
}

export function buildLocalizedAlternates(locale: LocaleCode, pathname: string) {
  const canonical = localizeSiteUrl(locale, pathname)

  return {
    canonical,
    languages: Object.fromEntries([
      ...locales.map((candidate) => [candidate, localizeSiteUrl(candidate, pathname)] as const),
      ['x-default', localizeSiteUrl(defaultLocale, pathname)] as const,
    ]),
  }
}

export function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template
  )
}
