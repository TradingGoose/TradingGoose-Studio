'use client'

import Footer from '@/app/(landing)/components/footer/footer'
import Nav from '@/app/(landing)/components/nav/nav'
import { soehne } from '@/app/fonts/soehne/soehne'

interface BlogLayoutProps {
  children: React.ReactNode
  /**
   * Canonical path for structured data (e.g. "/blog" or "/blog/my-post").
   */
  path?: string
  /** Page title for structured data breadcrumb. */
  title?: string
}

export default function BlogLayout({ children, path, title }: BlogLayoutProps) {
  const breadcrumbStructuredData = path
    ? {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://tradinggoose.ai',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Blog',
          item: 'https://tradinggoose.ai/blog',
        },
        ...(title
          ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: title,
              item: `https://tradinggoose.ai${path}`,
            },
          ]
          : []),
      ],
    }
    : null

  return (
    <main className={`${soehne.className} min-h-screen`}>
      {breadcrumbStructuredData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbStructuredData) }}
        />
      )}
      <Nav variant="legal" />

      <div className="border-b border-border px-4 pt-10 pb-80 sm:px-12 md:px-20 lg:px-60">{children}</div>

      <div className="relative z-20">
        <Footer fullWidth />
      </div>
    </main>
  )
}
