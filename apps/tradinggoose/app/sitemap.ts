import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/app/(landing)/blog/lib/posts'
import { locales } from '@/i18n/routing'
import { localizeSiteUrl } from '@/i18n/utils'

type SitemapEntry = Omit<MetadataRoute.Sitemap[number], 'url'>

function localizedEntries(pathname: string, entry: SitemapEntry): MetadataRoute.Sitemap {
  return locales.map((locale) => ({
    url: localizeSiteUrl(locale, pathname),
    ...entry,
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPosts()
  const lastModified = new Date()

  // Keep the sitemap focused on stable public-entry pages.
  // Auth flows like /login, /signup, and /waitlist are intentionally omitted.
  const staticPages = [
    ...localizedEntries('/', {
      lastModified,
      changeFrequency: 'daily' as const,
      priority: 1,
    }),
    ...localizedEntries('/changelog', {
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }),
    ...localizedEntries('/blog', {
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    }),
    ...localizedEntries('/terms', {
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }),
    ...localizedEntries('/privacy', {
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }),
    ...localizedEntries('/licenses', {
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    }),
    // Documentation subdomain — high-value citable surface for AI crawlers.
    // The docs site owns its own sitemap at docs.tradinggoose.ai/sitemap.xml,
    // but we anchor the root so crawlers that only parse the apex sitemap
    // still discover the entry point.
    {
      url: 'https://docs.tradinggoose.ai',
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    },
  ]

  const postPages = posts.flatMap((post) =>
    localizedEntries(`/blog/${post.slug}`, {
      lastModified: new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })
  )

  return [...staticPages, ...postPages]
}
