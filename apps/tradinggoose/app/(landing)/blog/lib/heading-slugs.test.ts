import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatBlogDate } from './heading-slugs'

describe('formatBlogDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes English locale codes and formats dates in UTC', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('February 14, 2024')

    expect(formatBlogDate('2024-02-14', 'long', 'en')).toBe('February 14, 2024')
    expect(spy).toHaveBeenCalledWith('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  })

  it('passes non-English locales through unchanged', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue(
      '14 de febrero de 2024'
    )

    expect(formatBlogDate('2024-02-14', 'long', 'es')).toBe('14 de febrero de 2024')
    expect(spy).toHaveBeenCalledWith('es', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  })
})
