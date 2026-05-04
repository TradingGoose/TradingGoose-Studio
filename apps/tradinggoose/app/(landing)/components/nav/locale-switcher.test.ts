import { describe, expect, it } from 'vitest'
import { buildLocaleSwitchHref } from './locale-switcher'

describe('buildLocaleSwitchHref', () => {
  it('strips any existing locale prefix before rebuilding localized hrefs', () => {
    expect(
      buildLocaleSwitchHref(
        'en',
        '/es/blog/trading-signals',
        new URLSearchParams('from=nav&source=landing')
      )
    ).toBe('/blog/trading-signals?from=nav&source=landing')

    expect(
      buildLocaleSwitchHref(
        'zh-CN',
        '/blog/trading-signals',
        new URLSearchParams('from=nav&source=landing')
      )
    ).toBe('/zh/blog/trading-signals?from=nav&source=landing')

    expect(buildLocaleSwitchHref('en', '/zh/blog/trading-signals', new URLSearchParams(''))).toBe(
      '/blog/trading-signals'
    )
  })
})
