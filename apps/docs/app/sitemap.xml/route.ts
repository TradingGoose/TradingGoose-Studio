import { i18n, localizePathname } from '@/lib/i18n'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET() {
  const baseUrl = 'https://docs.tradinggoose.ai'

  const allPages = source.getPages()

  const stripLanguagePrefix = (url: string) => {
    const segments = url.split('/').filter(Boolean)
    const firstSegment = segments[0]

    if (firstSegment && i18n.languages.includes(firstSegment as (typeof i18n.languages)[number])) {
      const pathname = `/${segments.slice(1).join('/')}`
      return pathname === '/' ? '/' : pathname.replace(/\/+$/, '')
    }

    return url || '/'
  }

  const getPriority = (url: string): string => {
    if (url === '/' || url === '/index') return '1.0'
    if (url === '/getting-started') return '0.9'
    if (url.match(/^\/[^/]+$/)) return '0.8'
    if (url.includes('/sdks/') || url.includes('/tools/')) return '0.7'
    return '0.6'
  }

  const urls = allPages
    .flatMap((page) => {
      const urlWithoutLang = stripLanguagePrefix(page.url)

      return i18n.languages.map((lang) => {
        const url = `${baseUrl}${localizePathname(lang, urlWithoutLang)}`

        return `  <url>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${getPriority(urlWithoutLang)}</priority>
    ${i18n.languages.length > 1 ? generateAlternateLinks(baseUrl, urlWithoutLang) : ''}
  </url>`
      })
    })
    .join('\n')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}

function generateAlternateLinks(baseUrl: string, urlWithoutLang: string): string {
  return i18n.languages
    .map((lang) => {
      const url = `${baseUrl}${localizePathname(lang, urlWithoutLang)}`
      return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}" />`
    })
    .join('\n')
}
