export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'
export const MARKDOWN_RENDER_ROUTE = '/api/markdown'
export const MARKDOWN_BYPASS_HEADER = 'x-tradinggoose-markdown-bypass'

const MARKDOWN_ACCEPT_PATTERN = /(^|,)\s*text\/markdown(?:\s*(?:;|,|$))/i

const EXACT_PUBLIC_PATHS = new Set([
  '/',
  '/blog',
  '/careers',
  '/changelog',
  '/licenses',
  '/privacy',
  '/terms',
])

type HeadersLike = Pick<Headers, 'get'>

export function requestAcceptsMarkdown(headers: HeadersLike): boolean {
  const accept = headers.get('accept') || ''
  return MARKDOWN_ACCEPT_PATTERN.test(accept)
}

export function isMarkdownRenderablePath(pathname: string): boolean {
  if (EXACT_PUBLIC_PATHS.has(pathname)) {
    return true
  }

  return /^\/blog\/[^/]+$/.test(pathname)
}

export function normalizeMarkdownPath(rawPath: string | null): string | null {
  if (!rawPath) {
    return '/'
  }

  const trimmed = rawPath.trim()

  if (!trimmed.startsWith('/')) {
    return null
  }

  if (trimmed.includes('://') || trimmed.includes('..')) {
    return null
  }

  return trimmed === '/' ? trimmed : trimmed.replace(/\/+$/, '')
}

export function appendVaryHeader(currentValue: string | null, nextValue: string): string {
  const existing = new Set(
    (currentValue || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.toLowerCase())
  )

  existing.add(nextValue.toLowerCase())

  return Array.from(existing)
    .map((part) => {
      if (part === 'user-agent') return 'User-Agent'
      if (part === 'accept') return 'Accept'
      return part
    })
    .join(', ')
}
