import Footer from '@/app/(landing)/components/footer/footer'
import PublicNav from '@/app/(landing)/components/nav/public-nav'
import { soehne } from '@/app/fonts/soehne/soehne'
import { getLocale } from 'next-intl/server'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode, localizeUrl } from '@/i18n/utils'

interface LegalLayoutProps {
  title: string
  children: React.ReactNode
  /**
   * Canonical path of this legal page (e.g. "/terms"). When provided, the
   * layout emits a BreadcrumbList JSON-LD script so AI crawlers can anchor
   * the page inside the TradingGoose entity graph.
   */
  path?: string
}

export default async function LegalLayout({ title, children, path }: LegalLayoutProps) {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const breadcrumbStructuredData = path
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: copy.nav.homeLabel,
            item: localizeUrl('https://tradinggoose.ai', locale, '/'),
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: title,
            item: localizeUrl('https://tradinggoose.ai', locale, path),
          },
        ],
      }
    : null

  return (
    <main className={`${soehne.className} min-h-screen`}>
      {breadcrumbStructuredData && (
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbStructuredData) }}
        />
      )}
      <PublicNav />

      {/* Content */}
      <div className='px-40 pt-[40px] pb-[40px]'>
        <h1 className='mb-12 text-center font-bold text-4xl md:text-5xl'>{title}</h1>
        <div className='text-accent-foreground prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 '>
          {children}
        </div>
      </div>


      <div className='relative z-20'>
        <Footer fullWidth={true} />
      </div>
    </main>
  )
}
