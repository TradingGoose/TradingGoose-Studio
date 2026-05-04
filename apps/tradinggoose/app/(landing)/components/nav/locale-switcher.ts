import { localizePathname, stripLocaleFromPathname, type LocaleCode } from '@/i18n/utils'

export function buildLocaleSwitchHref(
  locale: LocaleCode,
  pathname: string | null | undefined,
  searchParams: { toString(): string } | null | undefined
) {
  const normalizedPathname = stripLocaleFromPathname(pathname || '/').pathname
  const localizedPathname = localizePathname(locale, normalizedPathname)
  const queryString = searchParams?.toString()

  return queryString ? `${localizedPathname}?${queryString}` : localizedPathname
}

export function navigateToLocaleHref(href: string) {
  window.location.assign(href)
}
