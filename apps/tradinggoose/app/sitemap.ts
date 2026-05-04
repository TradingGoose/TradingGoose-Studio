import type { MetadataRoute } from 'next'
import { getBlogPostIndex, getPostsFromIndex } from '@/app/(landing)/blog/lib/posts'
import { locales, localizeUrl } from '@/i18n/utils'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://tradinggoose.ai'

  // Keep the sitemap focused on stable public-entry pages.
  // Auth flows like /login, /signup, and /waitlist are intentionally omitted.
  const localizedRoutes = ['/', '/blog'] as const
  // /careers is a live public landing page, so it is intentionally included here.
  const englishOnlyRoutes = ['/privacy', '/terms', '/licenses', '/careers', '/changelog'] as const

  const staticPages = locales.flatMap((locale) =>
    localizedRoutes.map((route) => ({
      url: localizeUrl(baseUrl, locale, route),
      lastModified: new Date(),
      changeFrequency: route === '/' ? ('daily' as const) : ('weekly' as const),
      priority: route === '/' ? 1 : 0.9,
    }))
  )

  const englishOnlyPages = englishOnlyRoutes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: route === '/changelog' ? 0.8 : 0.5,
  }))

  const blogIndex = await getBlogPostIndex()
  const postPages = (
    await Promise.all(
      locales.map(async (locale) => {
        const posts = await getPostsFromIndex(locale, blogIndex)
        return posts.map((post) => ({
          url: localizeUrl(baseUrl, locale, `/blog/${post.slug}`),
          lastModified: new Date(post.date),
          changeFrequency: 'monthly' as const,
          priority: 0.7,
        }))
      })
    )
  ).flat()

  const docsPage = {
    url: 'https://docs.tradinggoose.ai',
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.9,
  }

  return [...staticPages, ...englishOnlyPages, docsPage, ...postPages]
}
