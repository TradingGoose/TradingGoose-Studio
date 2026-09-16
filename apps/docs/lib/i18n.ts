import { defineI18n } from 'fumadocs-core/i18n'

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'es', 'zh'],
  hideLocale: 'never',
  fallbackLanguage: null,
  parser: 'dir',
})

export type DocsLocale = (typeof i18n.languages)[number]

export const DOCS_LOCALE_COOKIE = 'FD_LOCALE'
export const DOCS_LOCALE_MAX_AGE = 60 * 60 * 24 * 365

export function isDocsLocale(locale: string): locale is DocsLocale {
  return i18n.languages.includes(locale as DocsLocale)
}

export function getDocsPathname(pathname: string): string {
  const locale = pathname.split('/')[1]
  return isDocsLocale(locale) ? pathname.slice(locale.length + 1) || '/' : pathname
}

export function getLocalizedDocsHref(href: string, locale: DocsLocale): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href
  const pathname = href.split(/[?#]/, 1)[0]
  if (!isDocsPath(pathname) || isDocsLocale(pathname.split('/')[1])) return href
  return `/${locale}${pathname === '/' ? href.slice(1) : href}`
}

export function isDocsPath(pathname: string): boolean {
  return (
    !/^\/(?:api|_next|static|favicon|llms\.mdx)(?:\/|$)/.test(pathname) &&
    !/\/[^/]*\.[^/]*$/.test(pathname)
  )
}
