import path from 'node:path'
import { describe, expect, mock, test } from 'bun:test'
import { StructuredData } from '../../apps/docs/components/structured-data'
import { i18n } from '../../apps/docs/lib/i18n'
import { loader } from '../../apps/docs/node_modules/fumadocs-core/dist/source/index.js'
import { createMdxPlugin } from '../../apps/docs/node_modules/fumadocs-mdx/dist/bun/index.js'
import { NextRequest } from '../../apps/docs/node_modules/next/server'
import { renderToStaticMarkup } from '../../apps/docs/node_modules/react-dom/server'

const source = loader({
  baseUrl: '/',
  i18n,
  source: {
    files: [
      ...i18n.languages.flatMap((locale) =>
        ['index', 'guide'].map((slug) => ({
          type: 'page' as const,
          path: `${locale}/${slug}.mdx`,
          data: {
            title: `${slug}-${locale}`,
            description: `description-${locale}`,
            _exports: { llmText: `Compiled ${slug}-${locale} body` },
            get content(): string {
              throw new Error('Exports must not read or parse source files at request time')
            },
            body: () => null,
            structuredData: {
              headings: [],
              contents:
                locale === 'zh' && slug === 'guide'
                  ? [{ content: '知识库检索、条件分支和工作流变量支持 TradingGoose API。' }]
                  : [],
            },
          },
        }))
      ),
      {
        type: 'page' as const,
        path: 'en/english-only.mdx',
        data: {
          title: 'English-only content',
          description: 'Not translated',
          _exports: { llmText: 'Compiled English-only body' },
          body: () => null,
          structuredData: { headings: [], contents: [] },
        },
      },
    ],
  },
})

mock.module('../../apps/docs/lib/source', () => ({ source }))

const { default: Page, generateMetadata } = await import(
  '../../apps/docs/app/[lang]/[[...slug]]/page'
)
const { GET: search } = await import('../../apps/docs/app/api/search/route')
const { GET: sitemap } = await import('../../apps/docs/app/sitemap.xml/route')
const { GET: manifest } = await import('../../apps/docs/app/llms.txt/route')
const { GET: fullText } = await import('../../apps/docs/app/llms-full.txt/route')
const { GET: pageText } = await import('../../apps/docs/app/llms.mdx/[[...slug]]/route')

describe('locale-aware documentation output', () => {
  test('Fumadocs compilation exports Markdown before JSX transformations', async () => {
    const docsDir = path.resolve(import.meta.dir, '../../apps/docs')
    const result = await Bun.build({
      entrypoints: [path.join(docsDir, 'content/docs/en/connections/tags.mdx')],
      plugins: [createMdxPlugin({ configPath: path.join(docsDir, 'source.config.ts') })],
      target: 'bun',
      write: false,
    })
    expect(result.success).toBe(true)
    const url = URL.createObjectURL(result.outputs[0])
    try {
      const { llmText } = await import(url)
      expect(llmText).toContain('```text\n<blockName.path.to.data>\n```')
      expect(llmText).toMatch(/\| Reference\s+\| Meaning\s+\|/)
      expect(llmText).toContain('<Callout>')
      expect(llmText).toContain('[Data Structure](/connections/data-structure)')
      expect(llmText).not.toContain('export let')
      expect(llmText).not.toContain('title: Tags')
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  test.each(i18n.languages)(
    'metadata uses the explicit %s locale in canonical URLs',
    async (lang) => {
      const metadata = await generateMetadata({
        params: Promise.resolve({ lang, slug: ['guide'] }),
      })

      expect(metadata.title).toBe(`guide-${lang}`)
      expect(metadata.alternates).toEqual({
        canonical: `https://docs.tradinggoose.ai/${lang}/guide`,
        languages: {
          en: 'https://docs.tradinggoose.ai/en/guide',
          es: 'https://docs.tradinggoose.ai/es/guide',
          zh: 'https://docs.tradinggoose.ai/zh/guide',
        },
      })
      expect(metadata.openGraph.url).toBe(`https://docs.tradinggoose.ai/${lang}/guide`)
      expect(metadata.openGraph.locale).toBe({ en: 'en_US', es: 'es_ES', zh: 'zh_CN' }[lang])
    }
  )

  test('metadata advertises only translations that exist', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ lang: 'en', slug: ['english-only'] }),
    })
    expect(metadata.alternates.languages).toEqual({
      en: 'https://docs.tradinggoose.ai/en/english-only',
    })
    await expect(
      generateMetadata({ params: Promise.resolve({ lang: 'es', slug: ['english-only'] }) })
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  test.each(i18n.languages)(
    'breadcrumbs link to %s without a redundant locale segment',
    async (lang) => {
      const page = await Page({ params: Promise.resolve({ lang, slug: ['guide'] }) })
      expect(page.props.children[0].props.breadcrumb).toEqual([
        { name: `index-${lang}`, url: `https://docs.tradinggoose.ai/${lang}` },
        { name: `guide-${lang}`, url: `https://docs.tradinggoose.ai/${lang}/guide` },
      ])
    }
  )

  test('the sitemap includes every translated canonical URL with locale-independent priority', async () => {
    const xml = await (await sitemap()).text()
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

    expect(urls.sort()).toEqual([
      'https://docs.tradinggoose.ai/en',
      'https://docs.tradinggoose.ai/en/english-only',
      'https://docs.tradinggoose.ai/en/guide',
      'https://docs.tradinggoose.ai/es',
      'https://docs.tradinggoose.ai/es/guide',
      'https://docs.tradinggoose.ai/zh',
      'https://docs.tradinggoose.ai/zh/guide',
    ])
    expect([...xml.matchAll(/<priority>1\.0<\/priority>/g)]).toHaveLength(3)
    expect(xml).not.toContain('/es/english-only')
    expect(xml).not.toContain('/zh/english-only')
  })

  for (const [locale, headers] of [
    ['es', { cookie: 'FD_LOCALE=es', 'accept-language': 'en' }],
    ['zh', { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }],
  ] as const) {
    test(`all LLM exports select ${locale} without leaking English content`, async () => {
      const request = new NextRequest('https://docs.tradinggoose.ai/llms.txt', { headers })
      const responses = [
        await manifest(request),
        await fullText(request),
        await fullText(request),
        await pageText(request, { params: Promise.resolve({ slug: ['guide'] }) }),
      ]

      for (const response of responses) {
        expect(response.status).toBe(200)
        expect(response.headers.get('content-language')).toBe(locale)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('vary')).toBe('Cookie, Accept-Language')
        const text = await response.text()
        expect(text).toContain(`guide-${locale}`)
        if (response !== responses[0]) expect(text).toContain(`Compiled guide-${locale} body`)
        expect(text).not.toContain('guide-en')
        expect(text).not.toContain('English-only content')
        expect(text).toContain(`/${locale}/guide`)
      }
    })
  }

  test.each([
    ['en', 'zh', 'en', 'guide'],
    ['es', 'zh', 'es', 'guide'],
    ['zh', 'es', 'zh', 'guide'],
    ['fr', 'es', 'es', 'guide'],
    ...['知识', '条件', '工作流变量', 'TradingGoose API'].map((query) => ['', 'zh', 'zh', query]),
  ])(
    'search locale=%s cookie=%s selects only %s results for %s',
    async (requestedLocale, savedLocale, locale, query) => {
      const params = new URLSearchParams({ query })
      if (requestedLocale) params.set('locale', requestedLocale)
      const response = await search(
        new NextRequest(`https://docs.tradinggoose.ai/api/search?${params}`, {
          headers: { cookie: `FD_LOCALE=${savedLocale}` },
        })
      )
      const results = await response.json()
      expect(response.headers.get('content-language')).toBe(locale)
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((result: { url: string }) => result.url === `/${locale}/guide`)).toBe(
        true
      )
    }
  )

  test('LLM query locales override saved preference and generate locale-specific export links', async () => {
    const request = new NextRequest('https://docs.tradinggoose.ai/llms.txt?locale=es', {
      headers: { cookie: 'FD_LOCALE=zh' },
    })
    const response = await manifest(request)
    expect(response.headers.get('content-language')).toBe('es')
    const text = await response.text()
    expect(text).toContain('/es/guide')
    expect(text).toContain('/llms-full.txt?locale=es')
    expect(text).toContain('/llms.mdx/es/[page-path]')
    expect(text).toContain('### Guide')
    expect(text).not.toContain('### Es')
    expect(text).not.toContain('guide-zh')

    const fullResponse = await fullText(request)
    expect(fullResponse.headers.get('content-language')).toBe('es')
    expect(await fullResponse.text()).toContain('URL: /es/guide')
  })

  test('explicit LLM page locale wins over both the query locale and stale cookie', async () => {
    const response = await pageText(
      new NextRequest('https://docs.tradinggoose.ai/llms.mdx/es/guide?locale=zh', {
        headers: { cookie: 'FD_LOCALE=en' },
      }),
      { params: Promise.resolve({ slug: ['es', 'guide'] }) }
    )
    expect(response.headers.get('content-language')).toBe('es')
    expect(await response.text()).toContain('URL: /es/guide')
  })

  test('missing explicit translations return a private 404 rather than the saved English locale', async () => {
    const request = new NextRequest('https://docs.tradinggoose.ai/llms.mdx/zh/english-only', {
      headers: { cookie: 'FD_LOCALE=en' },
    })
    const response = await pageText(request, {
      params: Promise.resolve({ slug: ['zh', 'english-only'] }),
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-language')).toBe('zh')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).not.toContain('English-only content')
  })

  test('JSON-LD keeps the selected language and safely renders locale-prefixed URLs', () => {
    const html = renderToStaticMarkup(
      StructuredData({
        title: '</script><script>unexpected</script>',
        description: 'description-zh',
        url: 'https://docs.tradinggoose.ai/zh',
        lang: 'zh',
      })
    )

    expect(html).toContain('"inLanguage":"zh"')
    expect(html).toContain('"url":"https://docs.tradinggoose.ai/zh"')
    expect(html).toContain('\\u003c/script>')
    expect(html).not.toContain('<script>unexpected')
    expect(html).toContain('id="software-structured-data"')
  })
})
