/**
 * @vitest-environment node
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const { mockGetLocale, mockGetPublicCopy } = vi.hoisted(() => ({
  mockGetLocale: vi.fn(),
  mockGetPublicCopy: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getLocale: mockGetLocale,
}))

vi.mock('@/i18n/public-copy', () => ({
  getPublicCopy: mockGetPublicCopy,
}))

vi.mock('@/app/(landing)/components/footer/footer', () => ({
  default: () => <footer data-testid='footer' />,
}))

vi.mock('@/app/(landing)/components/nav/public-nav', () => ({
  default: () => <nav data-testid='nav' />,
}))

vi.mock('@/app/fonts/soehne/soehne', () => ({
  soehne: { className: 'soehne' },
}))

import BlogLayout from './blog-layout'

describe('BlogLayout', () => {
  it.each([
    {
      locale: 'es' as const,
      path: '/es/blog/trading-signals',
      expectedItem: 'https://tradinggoose.ai/es/blog/trading-signals',
    },
    {
      locale: 'zh-CN' as const,
      path: '/zh/blog/trading-signals',
      expectedItem: 'https://tradinggoose.ai/zh/blog/trading-signals',
    },
  ])(
    'normalizes localized breadcrumb paths for $locale',
    async ({ locale, path, expectedItem }) => {
      const publicLocale = locale === 'zh-CN' ? 'zh' : locale

      mockGetLocale.mockResolvedValue(locale)
      mockGetPublicCopy.mockReturnValue({
        blog: {
          home: 'Home',
          breadcrumbBlog: 'Blog',
        },
      })

      const element = await BlogLayout({
        children: <div>Body</div>,
        path,
        title: 'Trading Signals',
      })
      const markup = renderToStaticMarkup(element)
      const scriptMatch = markup.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)

      expect(scriptMatch).not.toBeNull()

      const structuredData = JSON.parse(scriptMatch?.[1] ?? '{}') as {
        itemListElement: Array<{ item?: string }>
      }

      expect(structuredData.itemListElement[0]?.item).toBe(
        `https://tradinggoose.ai/${publicLocale}`
      )
      expect(structuredData.itemListElement[1]?.item).toBe(
        `https://tradinggoose.ai/${publicLocale}/blog`
      )
      expect(structuredData.itemListElement[2]?.item).toBe(expectedItem)
      expect(markup).not.toContain(`/${locale}/${locale}/blog/trading-signals`)
    }
  )
})
