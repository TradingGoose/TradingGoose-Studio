/**
 * @vitest-environment node
 */

import type { Post } from '@/app/(landing)/blog/lib/types'
import { describe, expect, it, vi } from 'vitest'

const mockGetBlogPostIndex = vi.fn()
const mockGetPostsFromIndex = vi.fn()

vi.mock('@/app/(landing)/blog/lib/posts', () => ({
  getBlogPostIndex: (...args: unknown[]) => mockGetBlogPostIndex(...args),
  getPostsFromIndex: (...args: unknown[]) => mockGetPostsFromIndex(...args),
}))

function createPost(slug: string, date: string): Post {
  return {
    slug,
    date,
    title: slug,
    description: '',
    image: '',
    content: '',
    readingTime: 1,
    toc: [],
    authors: [],
    published: true,
  }
}

describe('sitemap', () => {
  it('builds localized blog URLs from a shared blog index', async () => {
    const blogIndex = { source: null, candidatesBySlug: new Map() }

    mockGetBlogPostIndex.mockResolvedValue(blogIndex)
    mockGetPostsFromIndex.mockImplementation(async (locale: string, index: typeof blogIndex) => {
      expect(index).toBe(blogIndex)

      if (locale === 'es') {
        return [createPost('es-post', '2026-04-02')]
      }

      if (locale === 'zh-CN') {
        return [createPost('zh-post', '2026-04-03')]
      }

      return [createPost('en-post', '2026-04-01')]
    })

    const { default: sitemap } = await import('./sitemap')
    const entries = await sitemap()

    expect(mockGetBlogPostIndex).toHaveBeenCalledTimes(1)
    expect(mockGetPostsFromIndex).toHaveBeenCalledTimes(3)
    expect(mockGetPostsFromIndex.mock.calls.map(([locale]) => locale)).toEqual(
      expect.arrayContaining(['en', 'es', 'zh-CN'])
    )

    const enPost = entries.find((entry) => entry.url === 'https://tradinggoose.ai/blog/en-post')
    const esPost = entries.find((entry) => entry.url === 'https://tradinggoose.ai/es/blog/es-post')
    const zhPost = entries.find((entry) => entry.url === 'https://tradinggoose.ai/zh/blog/zh-post')

    expect(enPost?.lastModified).toBeInstanceOf(Date)
    expect((enPost?.lastModified as Date).toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(esPost?.lastModified).toBeInstanceOf(Date)
    expect((esPost?.lastModified as Date).toISOString()).toBe('2026-04-02T00:00:00.000Z')
    expect(zhPost?.lastModified).toBeInstanceOf(Date)
    expect((zhPost?.lastModified as Date).toISOString()).toBe('2026-04-03T00:00:00.000Z')
  })
})
