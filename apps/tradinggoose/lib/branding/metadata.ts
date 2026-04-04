import type { Metadata } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

/**
 * Generate dynamic metadata based on brand configuration
 */
export function generateBrandedMetadata(override: Partial<Metadata> = {}): Metadata {
  const brand = getBrandConfig()

  const defaultTitle = brand.name
  const summaryFull = `TradingGoose is an open-source visual workflow platform for technical LLM-driven trading. Connect your own market data providers, write custom indicators in PineTS, monitor live prices, and wire signals into AI agent workflows that place trades, send alerts, rebalance portfolios, or run any action you define. Build workspaces with split-panel widgets, chart multiple indicators, and backtest strategies against historical candle data.`
  const summaryShort = `Open-source visual workflow platform for technical LLM-driven trading. Build custom indicators, monitor live markets, and trigger AI agent workflows.`

  return {
    title: {
      template: `%s | ${brand.name}`,
      default: defaultTitle,
    },
    description: summaryShort,
    applicationName: brand.name,
    authors: [{ name: brand.name }],
    generator: 'Next.js',
    keywords: [
      'AI trading workflows',
      'LLM trading agents',
      'technical trading automation',
      'custom trading indicators',
      'PineTS indicators',
      'visual trading workflow builder',
      'trading signal automation',
      'market data workflow',
      'backtesting platform',
      'open source trading platform',
      'algorithmic trading',
      'trading bot workflow',
      'AI trading assistant',
      'quant workflow tools',
    ],
    referrer: 'origin-when-cross-origin',
    creator: brand.name,
    publisher: brand.name,
    metadataBase: new URL(getBaseUrl()),
    alternates: {
      canonical: '/',
      languages: {
        'en-US': '/en-US',
      },
    },
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
      locale: 'en_US',
      url: getBaseUrl(),
      title: defaultTitle,
      description: summaryFull,
      siteName: brand.name,
      images: [
        {
          url: brand.logoUrl || '/favicon/web-app-manifest-512x512.png',
          width: 512,
          height: 512,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: defaultTitle,
      description: summaryFull,
      images: [brand.logoUrl || '/favicon/web-app-manifest-512x512.png'],
      creator: '@tradinggoose',
      site: '@tradinggoose',
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
        { url: brand.faviconUrl || '/favicon/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
      apple: '/favicon/apple-touch-icon.png',
      shortcut: brand.faviconUrl || '/favicon/favicon.ico',
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
    description:
      'TradingGoose is an open-source visual workflow platform for technical LLM-driven trading. Connect your own market data providers, write custom indicators in PineTS, monitor live prices, and route signals into AI agent workflows that trigger trades, alerts, portfolio rebalancing, or any action you define.',
    url: 'https://tradinggoose.ai',
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
      url: 'https://tradinggoose.ai',
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
