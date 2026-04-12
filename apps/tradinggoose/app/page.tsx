import type { Metadata } from 'next'
import { getPublicBillingCatalog } from '@/lib/billing/catalog'
import { buildHostedPricingSummary } from '@/lib/billing/public-catalog'
import { Background } from '@/app/(landing)/components'
import Landing from '@/app/(landing)/landing'

export const dynamic = 'force-dynamic'

const metadataBase: Metadata = {
  title: 'TradingGoose - Visual Workflow Platform for LLM Trading | Open Source',
  description:
    'Open-source visual workflow platform for technical LLM-driven trading. Connect your own data providers, write custom indicators in PineTS, monitor live markets, and trigger AI agent workflows on signals.',
  keywords:
    'AI trading workflows, LLM trading agents, technical trading automation, custom trading indicators, PineTS indicators, visual trading workflow builder, trading signal automation, market data workflow, backtesting platform, open source trading platform, algorithmic trading, AI trading assistant',
  authors: [{ name: 'TradingGoose Studio' }],
  creator: 'TradingGoose Studio',
  publisher: 'TradingGoose Studio',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'TradingGoose - Visual Workflow Platform for LLM Trading',
    description:
      'Open-source platform for technical LLM-driven trading. Custom indicators in PineTS, live market monitors, AI agent workflows triggered by market signals.',
    type: 'website',
    url: 'https://tradinggoose.ai',
    siteName: 'TradingGoose',
    locale: 'en_US',
    images: [
      {
        url: '/favicon/web-app-manifest-512x512.png',
        width: 512,
        height: 512,
        alt: 'TradingGoose Logo',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary',
    site: '@tradinggoose',
    creator: '@tradinggoose',
    title: 'TradingGoose - Visual Workflow Platform for LLM Trading',
    description:
      'Open-source platform for technical LLM-driven trading. Custom indicators, live monitors, AI agent workflows triggered by market signals.',
    images: {
      url: '/favicon/web-app-manifest-512x512.png',
      alt: 'TradingGoose Logo',
    },
  },
  alternates: {
    canonical: 'https://tradinggoose.ai',
    languages: {
      'en-US': 'https://tradinggoose.ai',
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
}

export async function generateMetadata(): Promise<Metadata> {
  const billingCatalog = await getPublicBillingCatalog()
  const pricingSummary = buildHostedPricingSummary(billingCatalog)

  return {
    ...metadataBase,
    other: {
      'llm:content-type':
        'visual workflow platform for trading, custom indicators, AI agent workflows for markets',
      'llm:use-cases':
        'signal-driven trade execution, portfolio rebalancing, indicator alerts, strategy backtesting, market sentiment analysis, custom trading dashboards',
      'llm:integrations':
        'OpenAI, Anthropic, Google Gemini, xAI, Mistral, Perplexity, Ollama, custom market data providers',
      'llm:pricing': pricingSummary || 'See hosted pricing on tradinggoose.ai',
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
