import { defineI18n } from 'fumadocs-core/i18n'

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'es', 'zh-CN'],
  hideLocale: 'default-locale',
  parser: 'dir',
})

type DocsLocale = (typeof i18n.languages)[number]

const PUBLIC_LOCALE_PATH_SEGMENTS: Record<DocsLocale, string> = {
  en: 'en',
  es: 'es',
  'zh-CN': 'zh',
}

export function getPublicLocalePathSegment(locale: DocsLocale) {
  return PUBLIC_LOCALE_PATH_SEGMENTS[locale]
}

export function stripLocaleFromPathname(pathname: string): { locale: DocsLocale; pathname: string } {
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]

  if (firstSegment) {
    const locale = i18n.languages.find(
      (candidate) =>
        candidate === firstSegment || getPublicLocalePathSegment(candidate) === firstSegment
    )

    if (locale) {
      const stripped = `/${segments.slice(1).join('/')}`.replace(/\/+$/, '')
      return {
        locale,
        pathname: stripped || '/',
      }
    }
  }

  return {
    locale: i18n.defaultLanguage,
    pathname: pathname || '/',
  }
}

export function localizePathname(locale: DocsLocale, pathname: string) {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')
  const localeSegment = getPublicLocalePathSegment(locale)

  if (locale === i18n.defaultLanguage) {
    return normalized
  }

  return normalized === '/' ? `/${localeSegment}` : `/${localeSegment}${normalized}`
}

export function localizeUrl(baseUrl: string, locale: DocsLocale, pathname: string) {
  return `${baseUrl}${localizePathname(locale, pathname)}`
}
