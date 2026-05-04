import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { getPublicBillingCatalog } from '@/lib/billing/catalog'
import { buildHostedPricingSummary } from '@/lib/billing/public-catalog'
import { Background } from '@/app/(landing)/components'
import Landing from '@/app/(landing)/landing'
import { getPublicCopy } from '@/i18n/public-copy'
import { getOpenGraphLocale, localizePathname, localizeUrl, locales } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as (typeof locales)[number]
  const billingCatalog = await getPublicBillingCatalog()
  const pricingSummary = buildHostedPricingSummary(billingCatalog)
  const copy = getPublicCopy(locale)
  const seo = copy.meta.landing.seo
  const baseUrl = 'https://tradinggoose.ai'
  const canonicalPath = localizePathname(locale, '/')
  const canonicalUrl = localizeUrl(baseUrl, locale, '/')
  const openGraphLocale = getOpenGraphLocale(locale)

  return {
    title: copy.meta.landing.title,
    description: copy.meta.landing.description,
    keywords: seo.keywords,
    authors: [{ name: 'TradingGoose Studio' }],
    creator: 'TradingGoose Studio',
    publisher: 'TradingGoose Studio',
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    openGraph: {
      title: copy.meta.landing.openGraphTitle,
      description: copy.meta.landing.openGraphDescription,
      type: 'website',
      url: canonicalUrl,
      siteName: 'TradingGoose',
      locale: openGraphLocale,
      alternateLocale: locales.filter((value) => value !== locale).map(getOpenGraphLocale),
      images: [
        {
          url: '/social-preview.png',
          width: 2559,
          height: 1398,
          alt: seo.socialPreviewAlt,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@tradinggoose',
      creator: '@tradinggoose',
      title: copy.meta.landing.openGraphTitle,
      description: copy.meta.landing.openGraphDescription,
      images: {
        url: '/social-preview.png',
        alt: seo.socialPreviewAlt,
      },
    },
    alternates: {
      canonical: canonicalPath,
      languages: {
        'x-default': baseUrl,
        en: baseUrl,
        es: `${baseUrl}/es`,
        'zh-CN': localizeUrl(baseUrl, 'zh-CN', '/'),
      },
    },
    robots: {
      index: true,
      follow: true,
      nocache: false,
      googleBot: {
        index: true,
        follow: true,
        noimageindex: false,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    category: 'finance',
    classification: 'Trading Platform',
    referrer: 'origin-when-cross-origin',
    other: {
      'llm:content-type': seo.llmContentType,
      'llm:use-cases': seo.llmUseCases,
      'llm:integrations': seo.llmIntegrations,
      'llm:pricing': pricingSummary || seo.llmPricing,
    },
  }
}

export default function Page() {
  return (
    <Background>
      <Landing />
    </Background>
  )
}
