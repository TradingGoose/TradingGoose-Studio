import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { i18n } from '@/lib/i18n'

const i18nProxy = createI18nMiddleware(i18n)

export function proxy(request: NextRequest, event?: Parameters<typeof i18nProxy>[1]) {
  const { pathname } = request.nextUrl

  if (pathname === '/zh-CN' || pathname.startsWith('/zh-CN/')) {
    return new NextResponse(null, { status: 404 })
  }

  if (pathname === '/zh' || pathname.startsWith('/zh/')) {
    const internalUrl = new URL(request.url)
    internalUrl.pathname = pathname === '/zh' ? '/zh-CN' : pathname.replace(/^\/zh(?=\/|$)/, '/zh-CN')
    return NextResponse.rewrite(internalUrl, {
      request: {
        headers: request.headers,
      },
    })
  }

  return i18nProxy(request, event as Parameters<typeof i18nProxy>[1])
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|static|robots.txt|sitemap.xml|llms.txt).*)'],
}
