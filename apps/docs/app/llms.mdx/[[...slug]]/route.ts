import type { NextRequest } from 'next/server'
import { isDocsLocale } from '@/lib/i18n'
import { getLLMText } from '@/lib/llms'
import { getRequestLocale } from '@/lib/locale-request'
import { source } from '@/lib/source'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug = [] } = await params
  const pathLocale = isDocsLocale(slug[0]) ? slug[0] : undefined
  const locale = getRequestLocale(request, pathLocale ?? request.nextUrl.searchParams.get('locale'))
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Language': locale,
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Accept-Language',
  }
  const page = source.getPage(pathLocale ? slug.slice(1) : slug, locale)
  if (!page) return new Response('Documentation page not found', { status: 404, headers })

  return new Response(getLLMText(page), { headers })
}
