import type { Metadata } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'
import { getPublicCopy } from '@/i18n/public-copy'
import { defaultLocale, getOpenGraphLocale, type LocaleCode, SITE_BASE_URL } from '@/i18n/utils'

export const DEFAULT_META_DESCRIPTION =
  'Open-source LLM trading platform. Connect data providers, write custom indicators in PineTS, and trigger AI agent workflows on live signals.'

/**
 * Generate dynamic metadata based on brand configuration
 */
export function generateBrandedMetadata(
  locale: LocaleCode = defaultLocale,
  override: Partial<Metadata> = {}
): Metadata {
  const brand = getBrandConfig()
  const copy = getPublicCopy(locale)
  const landingMeta = copy.meta.landing

  const defaultTitle = brand.name

  return {
    title: {
      template: `%s | ${brand.name}`,
      default: defaultTitle,
    },
    description: landingMeta.description,
    applicationName: brand.name,
    authors: [{ name: brand.name }],
    generator: 'Next.js',
    keywords: landingMeta.seo.keywords,
    referrer: 'origin-when-cross-origin',
    creator: brand.name,
    publisher: brand.name,
    metadataBase: new URL(SITE_BASE_URL),
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-video-preview': -1,
        'max-snippet': -1,
      },
    },
    openGraph: {
      type: 'website',
      locale: getOpenGraphLocale(locale),
      title: landingMeta.openGraphTitle,
      description: landingMeta.openGraphDescription,
      siteName: brand.name,
      images: [
        {
          url: '/social-preview.png',
          width: 2559,
          height: 1398,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: landingMeta.openGraphTitle,
      description: landingMeta.openGraphDescription,
      images: [{ url: '/social-preview.png', alt: brand.name }],
      creator: '@BruzWJ',
    },
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
        {
          url: '/favicon/web-app-manifest-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          url: '/favicon/web-app-manifest-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        { url: brand.faviconUrl, sizes: 'any', type: 'image/svg+xml' },
      ],
      apple: '/favicon/apple-touch-icon.png',
      shortcut: brand.faviconUrl,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: brand.name,
    },
    formatDetection: {
      telephone: false,
    },
    category: 'technology',
    other: {
      'apple-mobile-web-app-capable': 'yes',
      'mobile-web-app-capable': 'yes',
      'msapplication-TileColor': '#701FFC', // Default TradingGoose brand primary color
      'msapplication-config': '/favicon/browserconfig.xml',
    },
    ...override,
  }
}

/**
 * Generate static structured data for SEO
 */
export function generateStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'TradingGoose',
    alternateName: ['TradingGoose Studio', 'TradingGoose.ai'],
    description:
      'TradingGoose (also known as TradingGoose Studio) is an open-source visual workflow platform for technical LLM-driven trading, maintained at github.com/TradingGoose/TradingGoose-Studio. Connect your own market data providers, write custom indicators in PineTS, monitor live prices, and route signals into AI agent workflows that trigger trades, alerts, portfolio rebalancing, or any action you define. Not affiliated with the older TradingGoose multi-agent LLM research framework.',
    url: SITE_BASE_URL,
    sameAs: [
      'https://github.com/TradingGoose/TradingGoose-Studio',
      'https://docs.tradinggoose.ai',
      'https://discord.gg/wavf5JWhuT',
    ],
    applicationCategory: 'FinanceApplication',
    applicationSubCategory: 'Trading Platform',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      category: 'Open Source',
    },
    creator: {
      '@type': 'Organization',
      name: 'TradingGoose Studio',
      alternateName: 'TradingGoose',
      url: SITE_BASE_URL,
      sameAs: [
        'https://github.com/TradingGoose/TradingGoose-Studio',
        'https://discord.gg/wavf5JWhuT',
      ],
    },
    featureList: [
      'Custom indicator editor (PineTS)',
      'Live market data provider integrations',
      'AI agent workflows triggered by market signals',
      'Visual workflow canvas with widget workspace',
      'Backtesting against historical candle data',
      'Split-panel dashboards with saved layouts',
    ],
  }
}
