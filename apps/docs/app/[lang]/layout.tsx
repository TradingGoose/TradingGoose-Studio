import type { ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Geist_Mono, Inter } from 'next/font/google'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { DocsLayout } from '@/components/layout/docs'
import '../global.css'
import { isDocsLocale } from '@/lib/i18n'
import { source } from '@/lib/source'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

type LayoutProps = {
  children: ReactNode
  params: Promise<{ lang: string }>
}

export default async function Layout({ children, params }: LayoutProps) {
  const { lang } = await params

  if (!isDocsLocale(lang)) {
    notFound()
  }
  const locale = lang

  const tree = source.pageTree[locale]
  if (!tree) {
    notFound()
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'TradingGoose Documentation',
    description:
      'Comprehensive documentation for TradingGoose - the visual workflow builder for AI Agent Workflows.',
    url: 'https://docs.tradinggoose.ai',
    publisher: {
      '@type': 'Organization',
      name: 'TradingGoose',
      url: 'https://tradinggoose.ai',
      logo: {
        '@type': 'ImageObject',
        url: 'https://docs.tradinggoose.ai/static/logo.png',
      },
    },
    inLanguage: locale,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://docs.tradinggoose.ai/api/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className='flex min-h-screen flex-col font-sans'>
        <RootProvider>
          <DocsLayout
            tree={tree}
            i18n={false}
            themeSwitch={{
              enabled: true,
            }}
            nav={{
              title: 'Documentation',
              url: '/',
              logo: (
                <div className='flex h-8 w-8 items-center justify-center rounded-md bg-fd-primary'>
                  <Image
                    src='/static/logo.png'
                    alt='TradingGoose'
                    width={28}
                    height={28}
                    className='h-8 w-8'
                    priority
                  />
                </div>
              ),
            }}
            sidebar={{
              collapsible: true,
            }}
          >
            {children}
          </DocsLayout>
          <Analytics />
        </RootProvider>
      </body>
    </html>
  )
}
