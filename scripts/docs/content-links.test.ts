import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { getLocalizedDocsHref, i18n } from '../../apps/docs/lib/i18n'
import { remarkHeading } from '../../apps/docs/node_modules/fumadocs-core/dist/mdx-plugins/index.js'
import { remark } from '../../apps/docs/node_modules/remark/index.js'
import remarkGfm from '../../apps/docs/node_modules/remark-gfm/index.js'
import remarkMdx from '../../apps/docs/node_modules/remark-mdx/index.js'

const contentDir = path.resolve(import.meta.dir, '../../apps/docs/content/docs')
const pages = new Map(
  readdirSync(contentDir, { recursive: true })
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => [
      `/${file.replace(/(?:\/index)?\.mdx$/, '')}`,
      readFileSync(path.join(contentDir, file), 'utf8'),
    ])
)
const processor = remark().use(remarkMdx).use(remarkGfm).use(remarkHeading)

describe('documentation references', () => {
  test.each(i18n.languages)('%s section links target actual localized heading IDs', (locale) => {
    let checked = 0
    for (const [pathname, content] of pages) {
      if (pathname !== `/${locale}` && !pathname.startsWith(`/${locale}/`)) continue
      for (const [, href] of content.matchAll(
        /(?:\]\(|\bhref=["'])((?:\/[^#\s)"']*)?#[^\s)"']+)/g
      )) {
        const target = new URL(
          getLocalizedDocsHref(href, locale),
          `https://docs.tradinggoose.ai${pathname}`
        )
        const targetContent = pages.get(target.pathname)
        expect(targetContent, `${pathname}: ${href}`).toBeDefined()
        const file = { data: { toc: [] as { url: string }[] } }
        processor.runSync(
          processor.parse(targetContent!.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')),
          file
        )
        expect(
          file.data.toc.map((entry) => entry.url),
          `${pathname}: ${href}`
        ).toContain(decodeURIComponent(target.hash))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  test.each(i18n.languages)(
    '%s completed-container examples use actual container IDs',
    (locale) => {
      const tags = pages.get(`/${locale}/connections/tags`)!
      expect(tags).toContain('<loop-id.results>')
      expect(tags).toContain('<parallel-id.results>')
      for (const [pathname, content] of pages) {
        if (pathname.startsWith(`/${locale}/`)) {
          expect(content, pathname).not.toMatch(/\b(?:loop|parallel)\.results\b/)
        }
      }
    }
  )
})
