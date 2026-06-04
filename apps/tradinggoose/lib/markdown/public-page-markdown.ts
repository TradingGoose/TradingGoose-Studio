import { convertHtmlToMarkdown } from '@/lib/markdown/html-to-markdown'
import { type LocaleCode, localizeUrl } from '@/i18n/utils'

interface MarkdownDocumentOptions {
  title: string
  url: string
  body: string
  description?: string
}

function escapeFrontmatterValue(value: string): string {
  return JSON.stringify(value)
}

function buildMarkdownDocument({ title, url, body, description }: MarkdownDocumentOptions): string {
  const frontmatterLines = [
    '---',
    `title: ${escapeFrontmatterValue(title)}`,
    `url: ${escapeFrontmatterValue(url)}`,
  ]

  if (description) {
    frontmatterLines.push(`description: ${escapeFrontmatterValue(description)}`)
  }

  frontmatterLines.push('---')

  return `${frontmatterLines.join('\n')}\n\n${body.trim()}\n`
}

export async function renderPublicPageMarkdown(
  origin: string,
  locale: LocaleCode,
  pathname: string
): Promise<string | null> {
  const sourceUrl = localizeUrl(origin, locale, pathname)
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'text/html',
      'x-tradinggoose-markdown-bypass': '1',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    return null
  }

  const converted = convertHtmlToMarkdown(await response.text(), { sourceUrl })

  if (!converted.body) {
    return null
  }

  return buildMarkdownDocument({
    title: converted.title || `TradingGoose ${pathname}`,
    description: converted.description,
    url: sourceUrl,
    body: converted.body,
  })
}
