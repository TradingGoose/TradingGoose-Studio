import { getLocale } from 'next-intl/server'
import Footer from '@/app/(landing)/components/footer/footer'
import PublicNav from '@/app/(landing)/components/nav/public-nav'
import { soehne } from '@/app/fonts/soehne/soehne'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode, localizeUrl, stripLocaleFromPathname } from '@/i18n/utils'

interface BlogLayoutProps {
  children: React.ReactNode
  /**
   * Canonical path for structured data (e.g. "/blog" or "/blog/my-post").
   */
  path?: string
  /** Page title for structured data breadcrumb. */
  title?: string
}

export default async function BlogLayout({ children, path, title }: BlogLayoutProps) {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const canonicalPath = path ? stripLocaleFromPathname(path).pathname : null
  const breadcrumbStructuredData = path
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: copy.blog.home,
            item: localizeUrl('https://tradinggoose.ai', locale, '/'),
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: copy.blog.breadcrumbBlog,
            item: localizeUrl('https://tradinggoose.ai', locale, '/blog'),
          },
          ...(title
            ? [
                {
                  '@type': 'ListItem',
                  position: 3,
                  name: title,
                  item: localizeUrl('https://tradinggoose.ai', locale, canonicalPath ?? path),
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
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumbStructuredData).replace(/</g, '\\u003c'),
          }}
        />
      )}
      <PublicNav />

      <div className='border-border border-b px-4 pt-10 pb-80 sm:px-12 md:px-20 lg:px-60'>
        {children}
      </div>

      <div className='relative z-20'>
        <Footer fullWidth />
      </div>
    </main>
  )
}
