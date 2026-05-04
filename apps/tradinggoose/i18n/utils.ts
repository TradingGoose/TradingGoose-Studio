export type LocaleCode = 'en' | 'es' | 'zh-CN'

export const locales = ['en', 'es', 'zh-CN'] as const
export const defaultLocale: LocaleCode = 'en'
const DOCS_BASE_URL = 'https://docs.tradinggoose.ai'

const PUBLIC_LOCALE_PATH_SEGMENTS: Record<LocaleCode, string> = {
  en: 'en',
  es: 'es',
  'zh-CN': 'zh',
}

const OPEN_GRAPH_LOCALE_MAP: Record<LocaleCode, string> = {
  en: 'en_US',
  es: 'es_ES',
  'zh-CN': 'zh_CN',
}

export function getLocalePathSegment(locale: LocaleCode) {
  return PUBLIC_LOCALE_PATH_SEGMENTS[locale]
}

export function isLocaleCode(value: string): value is LocaleCode {
  return (locales as readonly string[]).includes(value)
}

export function stripLocaleFromPathname(pathname: string): { locale: LocaleCode; pathname: string } {
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]

  if (firstSegment) {
    const locale = locales.find((candidate) => getLocalePathSegment(candidate) === firstSegment)

    if (locale) {
      const stripped = `/${segments.slice(1).join('/')}`.replace(/\/+$/, '')
      return {
        locale,
        pathname: stripped || '/',
      }
    }
  }

  return {
    locale: defaultLocale,
    pathname: pathname || '/',
  }
}

export function localizePathname(locale: LocaleCode, pathname: string) {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')
  const localeSegment = getLocalePathSegment(locale)

  if (locale === defaultLocale) {
    return normalized
  }

  return normalized === '/' ? `/${localeSegment}` : `/${localeSegment}${normalized}`
}

export function localizeHref(locale: LocaleCode, href: string) {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href
  }

  const parsedUrl = new URL(href, 'http://tradinggoose.local')
  const { pathname } = stripLocaleFromPathname(parsedUrl.pathname)

  return `${localizePathname(locale, pathname)}${parsedUrl.search}${parsedUrl.hash}`
}

export function buildLocaleRequestHeaders(locale: LocaleCode, headers?: HeadersInit) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('x-next-intl-locale', locale)

  return requestHeaders
}

export function localizeUrl(baseUrl: string, locale: LocaleCode, pathname: string) {
  return `${baseUrl}${localizePathname(locale, pathname)}`
}

export function localizeDocsUrl(locale: LocaleCode, pathname = '/') {
  return localizeUrl(DOCS_BASE_URL, locale, pathname)
}

export function getOpenGraphLocale(locale: LocaleCode) {
  return OPEN_GRAPH_LOCALE_MAP[locale]
}
