import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware'
import { i18n } from '@/lib/i18n'

const i18nProxy = createI18nMiddleware(i18n)
export { i18nProxy as proxy }

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|static|robots.txt|sitemap.xml|llms.txt).*)'],
}
