import type { NextRequest } from 'next/server'
import { i18n } from '@/lib/i18n'
import { getRequestLocale } from '@/lib/locale-request'
import { source } from '@/lib/source'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const baseUrl = 'https://docs.tradinggoose.ai'
  const locale = getRequestLocale(request, request.nextUrl.searchParams.get('locale'))
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Language': locale,
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Accept-Language',
  }

  try {
    const pages = source.getPages(locale)

    const sections: Record<string, Array<{ title: string; url: string; description?: string }>> = {}

    pages.forEach((page) => {
      const section = page.slugs[0] || 'root'

      if (!sections[section]) {
        sections[section] = []
      }

      sections[section].push({
        title: page.data.title || 'Untitled',
        url: `${baseUrl}${page.url}`,
        description: page.data.description,
      })
    })

    const manifest = `# TradingGoose Documentation

> Visual Workflow Builder for AI Applications

TradingGoose is a visual workflow builder for AI applications that lets you build AI agent workflows visually. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.

## Documentation Overview

This file provides an overview of our documentation. For full content of all pages, see ${baseUrl}/llms-full.txt?locale=${locale}

## Main Sections

${Object.entries(sections)
  .map(([section, items]) => {
    const sectionTitle = section
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return `### ${sectionTitle}\n\n${items.map((item) => `- ${item.title}: ${item.url}${item.description ? `\n  ${item.description}` : ''}`).join('\n')}`
  })
  .join('\n\n')}

## Additional Resources

- Full documentation content: ${baseUrl}/llms-full.txt?locale=${locale}
- Individual page content: ${baseUrl}/llms.mdx/${locale}/[page-path]

## Statistics

- Total pages: ${pages.length}
- Content language: ${locale}
- Languages: ${i18n.languages.join(', ')}

---

Generated: ${new Date().toISOString()}
Format: llms.txt v0.1.0
See: https://llmstxt.org for specification`

    return new Response(manifest, { headers })
  } catch (error) {
    console.error('Error generating LLM manifest:', error)
    return new Response('Error generating documentation manifest', { status: 500, headers })
  }
}
