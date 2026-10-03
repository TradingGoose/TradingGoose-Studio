import type { NextRequest } from 'next/server'
import { getLLMText } from '@/lib/llms'
import { getRequestLocale } from '@/lib/locale-request'
import { source } from '@/lib/source'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const locale = getRequestLocale(request, request.nextUrl.searchParams.get('locale'))
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Language': locale,
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Accept-Language',
  }

  try {
    const text = source.getPages(locale).map(getLLMText).join('\n\n---\n\n')
    return new Response(text, { headers })
  } catch (error) {
    console.error('Error generating LLM full text:', error)
    return new Response('Error generating full documentation text', { status: 500, headers })
  }
}
