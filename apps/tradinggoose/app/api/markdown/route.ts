import type { NextRequest } from 'next/server'
import { appendHomepageDiscoveryLinks } from '@/lib/discovery/link-headers'
import {
  appendVaryHeader,
  isMarkdownRenderablePath,
  MARKDOWN_CONTENT_TYPE,
  normalizeMarkdownPath,
} from '@/lib/markdown/negotiation'
import { renderPublicPageMarkdown } from '@/lib/markdown/public-page-markdown'
import { getAccurateTokenCount } from '@/lib/tokenization/estimators'
import { stripLocaleFromPathname } from '@/i18n/utils'

async function createMarkdownResponse(request: NextRequest, includeBody: boolean) {
  const pathname = normalizeMarkdownPath(request.nextUrl.searchParams.get('path'))

  if (!pathname) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }

  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(pathname)

  if (!isMarkdownRenderablePath(normalizedPathname)) {
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

  const headers = new Headers({
    'Content-Type': MARKDOWN_CONTENT_TYPE,
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    Vary: appendVaryHeader(null, 'Accept'),
    'x-markdown-tokens': String(tokenCount),
  })

  if (normalizedPathname === '/') {
    appendHomepageDiscoveryLinks(headers, locale)
  }

  return new Response(includeBody ? markdown : null, { headers })
}

export async function GET(request: NextRequest) {
  return createMarkdownResponse(request, true)
}

export async function HEAD(request: NextRequest) {
  return createMarkdownResponse(request, false)
}
