import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://tradinggoose.ai'

  // Only include routes that are actually reachable in hosted mode.
  // proxy.ts (HOSTED_ALLOWED_PATHS) restricts public routes to:
  //   /, /licenses, /privacy, /terms, /changelog
  // plus static files (robots.txt, sitemap.xml, llms.txt, llms-full.txt, changelog.xml).
  // Listing /signup, /login, /careers, etc. here would submit 404 URLs to AI crawlers
  // and actively hurt GEO — do not add routes here without updating proxy.ts first.
  const staticPages = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
    {
      url: `${baseUrl}/licenses`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    },
    // Documentation subdomain — high-value citable surface for AI crawlers.
    // The docs site owns its own sitemap at docs.tradinggoose.ai/sitemap.xml,
    // but we anchor the root so crawlers that only parse the apex sitemap
    // still discover the entry point.
    {
      url: 'https://docs.tradinggoose.ai',
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    },
  ]

  return staticPages
}
