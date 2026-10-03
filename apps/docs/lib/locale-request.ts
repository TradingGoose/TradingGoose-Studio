import { getNegotiator } from 'fumadocs-core/negotiation'
import type { NextRequest } from 'next/server'
import { DOCS_LOCALE_COOKIE, type DocsLocale, i18n, isDocsLocale } from './i18n'

export function getRequestLocale(
  request: NextRequest,
  requestedLocale?: string | null
): DocsLocale {
  const pathLocale = request.nextUrl.pathname.split('/')[1]
  if (isDocsLocale(pathLocale)) return pathLocale
  if (requestedLocale && isDocsLocale(requestedLocale)) return requestedLocale
  const savedLocale = request.cookies.get(DOCS_LOCALE_COOKIE)?.value
  if (savedLocale && isDocsLocale(savedLocale)) return savedLocale
  return getNegotiator(request).languages(i18n.languages).find(isDocsLocale) ?? i18n.defaultLanguage
}
