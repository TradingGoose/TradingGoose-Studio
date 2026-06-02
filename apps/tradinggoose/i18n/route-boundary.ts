import { defaultLocale, type LocaleCode, stripLocaleFromPathname } from './utils'

function prefixLocalePathname(locale: LocaleCode, pathname: string) {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')

  if (locale === defaultLocale) {
    return normalized
  }

  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

export function getRouteBoundaryHref(locale: LocaleCode, href: string) {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href
  }

  const parsedUrl = new URL(href, 'http://tradinggoose.local')
  const { pathname } = stripLocaleFromPathname(parsedUrl.pathname)

  return `${prefixLocalePathname(locale, pathname)}${parsedUrl.search}${parsedUrl.hash}`
}

export function getRouteBoundaryUrl(baseUrl: string, locale: LocaleCode, href: string) {
  return new URL(getRouteBoundaryHref(locale, href), baseUrl).toString()
}
