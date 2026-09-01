import { i18n } from '@/lib/i18n'
import { getLLMText } from '@/lib/llms'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET() {
  try {
    const localizedPrefixes = new Set<string>(
      i18n.languages.filter((locale) => locale !== i18n.defaultLanguage)
    )
    const pages = source.getPages().filter((page) => {
      if (!page || !page.data || !page.url) return false

      const pathParts = page.url.split('/').filter(Boolean)
      const hasLangPrefix = pathParts[0] && localizedPrefixes.has(pathParts[0])

      return !hasLangPrefix
    })

    const scan = pages.map((page) => getLLMText(page))
    const scanned = await Promise.all(scan)

    const filtered = scanned.filter((text) => text && text.length > 0)

    return new Response(filtered.join('\n\n---\n\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  } catch (error) {
    console.error('Error generating LLM full text:', error)
    return new Response('Error generating full documentation text', { status: 500 })
  }
}
