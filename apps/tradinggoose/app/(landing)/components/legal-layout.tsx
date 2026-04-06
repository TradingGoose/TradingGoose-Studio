'use client'

import { isHosted } from '@/lib/environment'
import Footer from '@/app/(landing)/components/footer/footer'
import Nav from '@/app/(landing)/components/nav/nav'
import { soehne } from '@/app/fonts/soehne/soehne'

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

export default function LegalLayout({ title, children, path }: LegalLayoutProps) {
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
            name: title,
            item: `https://tradinggoose.ai${path}`,
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
      {/* Header - Nav handles all conditional logic */}
      <Nav variant='legal' />

      {/* Content */}
      <div className='px-40 pt-[40px] pb-[40px]'>
        <h1 className='mb-12 text-center font-bold text-4xl md:text-5xl'>{title}</h1>
        <div className='text-accent-foreground prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 '>
          {children}
        </div>
      </div>

      {/* Footer - Only for hosted instances */}
      {isHosted && (
        <div className='relative z-20'>
          <Footer fullWidth={true} />
        </div>
      )}
    </main>
  )
}
