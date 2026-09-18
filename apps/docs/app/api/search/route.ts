import { createFromSource } from 'fumadocs-core/search/server'
import { NextRequest } from 'next/server'
import { getRequestLocale } from '@/lib/locale-request'
import { source } from '@/lib/source'

const chineseSegmenter = new Intl.Segmenter('zh', { granularity: 'word' })

const search = createFromSource(source, {
  localeMap: {
    zh: {
      tokenizer: {
        language: 'chinese',
        normalizationCache: new Map(),
        tokenize: (text) => [
          ...new Set(
            [...chineseSegmenter.segment(text.normalize('NFKC').toLowerCase())]
              .filter((part) => part.isWordLike)
              .map((part) => part.segment)
          ),
        ],
      },
    },
  },
})

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request, request.nextUrl.searchParams.get('locale'))
  const url = request.nextUrl.clone()
  url.searchParams.set('locale', locale)
  const response = await search.GET(new NextRequest(url, { headers: request.headers }))
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Vary', 'Cookie, Accept-Language')
  response.headers.set('Content-Language', locale)
  return response
}
