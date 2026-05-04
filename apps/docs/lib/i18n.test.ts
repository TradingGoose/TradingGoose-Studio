import { describe, expect, it } from 'vitest'
import { localizePathname, stripLocaleFromPathname } from './i18n'

describe('docs i18n helpers', () => {
  it('maps the Chinese locale to the public zh path segment', () => {
    expect(localizePathname('zh-CN', '/getting-started')).toBe('/zh/getting-started')
    expect(localizePathname('zh-CN', '/getting-started')).not.toContain('/zh-CN')
  })

  it('strips the public zh segment back to the internal zh-CN locale', () => {
    expect(stripLocaleFromPathname('/zh/getting-started')).toEqual({
      locale: 'zh-CN',
      pathname: '/getting-started',
    })
  })
})
