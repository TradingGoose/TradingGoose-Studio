import type { NextRequest } from 'next/server'
import { getLLMText } from '@/lib/llms'
import { getRequestLocale } from '@/lib/locale-request'
import { source } from '@/lib/source'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request, request.nextUrl.searchParams.get('locale'))
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Language': locale,
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Accept-Language',
  }

  try {
    const pages = source.getPages(locale)

    const scan = pages.map((page) => getLLMText(page))
    const scanned = await Promise.all(scan)

    const filtered = scanned.filter((text) => text && text.length > 0)

    return new Response(filtered.join('\n\n---\n\n'), { headers })
  } catch (error) {
    console.error('Error generating LLM full text:', error)
    return new Response('Error generating full documentation text', { status: 500, headers })
  }
}
