import { type NextRequest, NextResponse } from 'next/server'
import { getLocalizedDocsHref, isDocsLocale, isDocsPath } from './lib/i18n'
import { getRequestLocale } from './lib/locale-request'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (!isDocsPath(pathname)) return NextResponse.next()

  const pathLocale = pathname.split('/')[1]
  const locale = getRequestLocale(request)
  if (isDocsLocale(pathLocale)) {
    const response = NextResponse.next()
    response.headers.set('Content-Language', locale)
    return response
  }

  const url = request.nextUrl.clone()
  url.pathname = getLocalizedDocsHref(pathname, locale)
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Vary', 'Cookie, Accept-Language')
  response.headers.set('Content-Language', locale)
  return response
}

export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next(?:/|$)|static(?:/|$)|favicon(?:/|$)|llms\\.mdx(?:/|$)|.*\\.[^/]+$).*)',
  ],
}
