import type { NextRequest } from 'next/server'
import {
  appendVaryHeader,
  isMarkdownRenderablePath,
  MARKDOWN_CONTENT_TYPE,
  normalizeMarkdownPath,
} from '@/lib/markdown/negotiation'
import { renderPublicPageMarkdown } from '@/lib/markdown/public-page-markdown'
import { getAccurateTokenCount } from '@/lib/tokenization/estimators'

export async function GET(request: NextRequest) {
  const pathname = normalizeMarkdownPath(request.nextUrl.searchParams.get('path'))

  if (!pathname || !isMarkdownRenderablePath(pathname)) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }

  const markdown = await renderPublicPageMarkdown(request.nextUrl.origin, pathname)

  if (!markdown) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }

  const tokenCount = getAccurateTokenCount(markdown)

  return new Response(markdown, {
    headers: {
      'Content-Type': MARKDOWN_CONTENT_TYPE,
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      Vary: appendVaryHeader(null, 'Accept'),
      'x-markdown-tokens': String(tokenCount),
    },
  })
}
