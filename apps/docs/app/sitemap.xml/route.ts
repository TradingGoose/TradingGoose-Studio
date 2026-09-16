import { getDocsPathname } from '@/lib/i18n'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET() {
  const baseUrl = 'https://docs.tradinggoose.ai'

  const getPriority = (url: string): string => {
    if (url === '/') return '1.0'
    if (url === '/getting-started') return '0.9'
    if (url.match(/^\/[^/]+$/)) return '0.8'
    if (url.includes('/sdks/') || url.includes('/tools/')) return '0.7'
    return '0.6'
  }

  const urls = [...new Set(source.getPages().map((page) => page.url))]
    .map((url) => {
      return `  <url>
    <loc>${baseUrl}${url}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${getPriority(getDocsPathname(url))}</priority>
  </url>`
    })
    .join('\n')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
