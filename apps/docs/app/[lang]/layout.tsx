import type { ReactNode } from 'react'
import { defineI18nUI } from 'fumadocs-ui/i18n'
import { DocsLayout } from '@/components/layout/docs'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Geist_Mono, Inter } from 'next/font/google'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import '../global.css'
import { i18n } from '@/lib/i18n'
import { source } from '@/lib/source'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      displayName: 'English',
    },
    es: {
      displayName: 'Español',
    },
    fr: {
      displayName: 'Français',
    },
    de: {
      displayName: 'Deutsch',
    },
    ja: {
      displayName: '日本語',
    },
    zh: {
      displayName: '简体中文',
    },
  },
})

type LayoutProps = {
  children: ReactNode
  params: Promise<{ lang: string }>
}

function isSupportedLang(
  lang: string,
): lang is (typeof i18n.languages)[number] {
  return i18n.languages.includes(lang as (typeof i18n.languages)[number])
}

export default async function Layout({ children, params }: LayoutProps) {
  const { lang } = await params

  if (!isSupportedLang(lang)) {
    notFound()
  }
  const locale = lang

  const tree =
    source.pageTree[locale] ??
    (i18n.defaultLanguage ? source.pageTree[i18n.defaultLanguage] : undefined) ??
    Object.values(source.pageTree)[0]
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
        <RootProvider i18n={provider(locale)}>
          <DocsLayout
            tree={tree}
            i18n
            themeSwitch={{
              enabled: true,
            }}
            nav={{
              title: 'Documentations',
              url: `/${locale}`,
              logo: (
                <div className="flex h-8 w-8 items-center justify-center bg-fd-primary rounded-md">
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
