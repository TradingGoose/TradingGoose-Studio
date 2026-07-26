import { getLocale } from 'next-intl/server'
import { getPublicBillingCatalog } from '@/lib/billing/catalog'
import { buildHostedPricingNarrative } from '@/lib/billing/public-catalog'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode, localizeSiteUrl } from '@/i18n/utils'
import { getBaseUrl } from '@/lib/urls/utils'

const STRUCTURED_DATA_MODIFIED_AT = '2026-04-04T00:00:00+00:00'

function buildStructuredOffers(
  catalog: Awaited<ReturnType<typeof getPublicBillingCatalog>>,
  siteEntityUrl: (id: string) => string
) {
  if (!catalog.billingEnabled) {
    return []
  }

  const offers: Array<Record<string, unknown>> = catalog.publicTiers.map((tier) => {
    const baseOffer: Record<string, unknown> = {
      '@type': 'Offer',
      '@id': siteEntityUrl(`offer-${tier.id}`),
      name: tier.displayName,
      description: tier.description,
      availability: 'https://schema.org/InStock',
      seller: { '@id': siteEntityUrl('organization') },
      eligibleRegion: { '@type': 'Place', name: 'Worldwide' },
    }

    const hasMonthlyPrice = (tier.monthlyPriceUsd ?? 0) > 0
    const hasYearlyPrice = (tier.yearlyPriceUsd ?? 0) > 0

    if (!hasMonthlyPrice && !hasYearlyPrice) {
      return {
        ...baseOffer,
        price: '0',
        priceCurrency: 'USD',
      }
    }

    if (hasYearlyPrice && !hasMonthlyPrice) {
      return {
        ...baseOffer,
        price: `${tier.yearlyPriceUsd ?? 0}`,
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: `${tier.yearlyPriceUsd ?? 0}`,
          priceCurrency: 'USD',
          unitText: 'YEAR',
          billingIncrement: 1,
        },
      }
    }

    return {
      ...baseOffer,
      price: `${tier.monthlyPriceUsd ?? 0}`,
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: `${tier.monthlyPriceUsd ?? 0}`,
        priceCurrency: 'USD',
        unitText: 'MONTH',
        billingIncrement: 1,
      },
    }
  })

  if (catalog.enterprisePlaceholder) {
    offers.push({
      '@type': 'Offer',
      '@id': siteEntityUrl('offer-enterprise'),
      name: catalog.enterprisePlaceholder.displayName,
      description: catalog.enterprisePlaceholder.description,
      availability: 'https://schema.org/InStock',
      seller: { '@id': siteEntityUrl('organization') },
      eligibleRegion: { '@type': 'Place', name: 'Worldwide' },
      ...(catalog.enterprisePlaceholder.contactUrl
        ? { url: catalog.enterprisePlaceholder.contactUrl }
        : {}),
    })
  }

  return offers
}

export default async function StructuredData() {
  const billingCatalog = await getPublicBillingCatalog()
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const siteBaseUrl = getBaseUrl()
  const siteEntityUrl = (id: string) => `${siteBaseUrl}/#${id}`
  const siteAssetUrl = (pathname: string) => `${siteBaseUrl}${pathname}`
  const siteHomeUrl = localizeSiteUrl(locale, '/')
  const pricingNarrative = billingCatalog.billingEnabled
    ? buildHostedPricingNarrative(billingCatalog)
    : ''
  const pricingFaqText = pricingNarrative
    ? `${pricingNarrative} Self-hosting the open-source Studio edition is free under the project license.`
    : 'Self-hosting the open-source Studio edition is free under the project license.'
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': siteEntityUrl('organization'),
        name: 'TradingGoose',
        alternateName: ['TradingGoose Studio', 'TradingGoose.ai'],
        legalName: 'TradingGoose Studio',
        description:
          'TradingGoose (also known as TradingGoose Studio) is an open-source visual workflow platform for technical LLM-driven trading, maintained at github.com/TradingGoose/TradingGoose-Studio. It is a drag-and-drop workflow builder for custom indicators, live market monitors, and AI agent automations — not to be confused with the older TradingGoose multi-agent research framework.',
        url: siteHomeUrl,
        foundingDate: '2026-04-04',
        knowsAbout: [
          'Algorithmic trading',
          'LLM trading agents',
          'Technical analysis indicators',
          'PineTS scripting',
          'Workflow automation',
          'Backtesting',
          'Market data integration',
        ],
        logo: {
          '@type': 'ImageObject',
          '@id': siteEntityUrl('logo'),
          url: siteAssetUrl('/favicon/web-app-manifest-512x512.png'),
          contentUrl: siteAssetUrl('/favicon/web-app-manifest-512x512.png'),
          width: 512,
          height: 512,
          caption: 'TradingGoose Logo',
        },
        image: { '@id': siteEntityUrl('logo') },
        sameAs: [
          'https://github.com/TradingGoose/TradingGoose-Studio',
          'https://discord.gg/wavf5JWhuT',
          'https://docs.tradinggoose.ai',
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          availableLanguage: [locale],
        },
      },
      {
        '@type': 'WebSite',
        '@id': siteEntityUrl('website'),
        url: siteHomeUrl,
        name: 'TradingGoose - Visual Workflow Platform for LLM Trading',
        description:
          'Open-source platform for technical LLM-driven trading. Connect data providers, write custom indicators in PineTS, trigger AI agent workflows on market signals.',
        publisher: {
          '@id': siteEntityUrl('organization'),
        },
        potentialAction: [
          {
            '@type': 'SearchAction',
            '@id': siteEntityUrl('searchaction'),
            target: {
              '@type': 'EntryPoint',
              urlTemplate: localizeSiteUrl(locale, '/search?q={search_term_string}'),
            },
            'query-input': 'required name=search_term_string',
          },
        ],
        inLanguage: locale,
      },
      {
        '@type': 'WebPage',
        '@id': siteEntityUrl('webpage'),
        url: siteHomeUrl,
        name: 'TradingGoose - Build your Trading Analysis with AI Agent Workflows',
        isPartOf: {
          '@id': siteEntityUrl('website'),
        },
        about: {
          '@id': siteEntityUrl('software'),
        },
        datePublished: '2025-01-01T00:00:00+00:00',
        dateModified: STRUCTURED_DATA_MODIFIED_AT,
        description:
          'Build AI-powered trading analysis workflows with TradingGoose. Connect live data providers, write custom indicators, and deploy agents that trigger on market signals.',
        breadcrumb: {
          '@id': siteEntityUrl('breadcrumb'),
        },
        inLanguage: locale,
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', 'h2', '.hero-description'],
        },
        potentialAction: [
          {
            '@type': 'ReadAction',
            target: [siteHomeUrl],
          },
        ],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': siteEntityUrl('breadcrumb'),
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: copy.nav.homeLabel,
            item: siteHomeUrl,
          },
        ],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': siteEntityUrl('software'),
        name: 'TradingGoose Studio',
        description:
          'Open-source visual workflow platform for technical LLM-driven trading. Connect your own market data providers, write custom indicators in PineTS, monitor live prices, and route signals into AI agent workflows that place trades, send alerts, or rebalance portfolios.',
        applicationCategory: 'FinanceApplication',
        applicationSubCategory: 'Trading Platform',
        operatingSystem: 'Web, Windows, macOS, Linux',
        softwareVersion: '2026.04.04',
        offers: buildStructuredOffers(billingCatalog, siteEntityUrl),
        featureList: [
          'Visual workflow canvas for trading strategies',
          'Custom indicator editor (PineTS)',
          'Live market data provider integrations',
          'Backtesting against historical candle data',
          'AI model support (OpenAI, Anthropic, Google, xAI, Mistral, Perplexity, Ollama)',
          'Split-panel workspace with saved widget layouts',
          'Workflow triggers on indicator signals (RSI, Bollinger Bands, Supertrend, custom)',
          'Scheduled and event-driven automations',
        ],
        screenshot: [
          {
            '@type': 'ImageObject',
            url: siteAssetUrl('/favicon/web-app-manifest-512x512.png'),
            caption: 'TradingGoose visual trading workflow builder',
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': siteEntityUrl('faq'),
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is TradingGoose?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'TradingGoose is an open-source visual workflow platform for technical LLM-driven trading. You connect your own market data providers, write custom indicators in PineTS, monitor live prices, and wire signals into AI agent workflows that can place trades, send alerts, rebalance portfolios, or run any action you define.',
            },
          },
          {
            '@type': 'Question',
            name: 'Which AI models does TradingGoose support?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'TradingGoose supports major AI models including OpenAI (GPT-5, GPT-4o), Anthropic Claude, Google Gemini, xAI Grok, Mistral, and Perplexity. You can also connect open-source models via Ollama for local inference.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is TradingGoose open source?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. TradingGoose Studio is open source and available on GitHub at github.com/TradingGoose/TradingGoose-Studio. You can self-host it, inspect the code, and contribute.',
            },
          },
          {
            '@type': 'Question',
            name: 'Can I write custom trading indicators in TradingGoose?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. TradingGoose ships with built-in indicators (RSI, Bollinger Bands, Supertrend and more) plus a PineTS editor for writing your own. You can connect any streaming data provider with your own credentials and monitor prices at any interval.',
            },
          },
          {
            '@type': 'Question',
            name: 'Does TradingGoose provide financial advice?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No. TradingGoose is a workflow platform, not a financial advisor. It provides the building blocks to create your own trading automations. You define the strategies, the signals, and the actions. Use it at your own risk.',
            },
          },
          {
            '@type': 'Question',
            name: 'How much does TradingGoose cost?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: pricingFaqText,
            },
          },
          {
            '@type': 'Question',
            name: 'Can I self-host TradingGoose?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. TradingGoose Studio is fully self-hostable. Clone the repository at github.com/TradingGoose/TradingGoose-Studio, provide your own database and AI provider credentials, and run it on your own infrastructure. Docker images and deployment guides are in the documentation at docs.tradinggoose.ai.',
            },
          },
          {
            '@type': 'Question',
            name: 'Can TradingGoose backtest trading strategies?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. TradingGoose supports backtesting against historical candle data. You can run any indicator or workflow against past market conditions to validate signal quality before deploying to live monitors.',
            },
          },
          {
            '@type': 'Question',
            name: 'What is PineTS and how does it differ from Pine Script?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'PineTS is TradingGoose’s TypeScript-based indicator language. It borrows the familiar concepts from TradingView Pine Script (series, ta.* functions, built-in indicators) but executes in a standard TypeScript runtime, giving you full typing, testing, and tooling. PineTS is purpose-built for TradingGoose’s streaming monitors and is not directly compatible with TradingView Pine Script source.',
            },
          },
          {
            '@type': 'Question',
            name: 'Does TradingGoose execute trades automatically?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Only if you wire it up to do so. TradingGoose does not execute trades on its own and is not a broker. You bring your own broker or exchange credentials and define the actions a workflow takes when a signal fires. The platform ships with safe-by-default behavior — workflows only take actions you explicitly configure.',
            },
          },
        ],
      },
      {
        '@type': 'Article',
        '@id': siteEntityUrl('article-disambiguation'),
        headline:
          'TradingGoose Studio: open-source visual workflow platform for LLM-driven trading',
        description:
          'Canonical reference page for TradingGoose Studio. This is the drag-and-drop workflow builder with PineTS custom indicators, live market monitors, and AI agent automation — distinct from the older TradingGoose multi-agent LLM research framework.',
        author: { '@id': siteEntityUrl('organization') },
        publisher: { '@id': siteEntityUrl('organization') },
        mainEntityOfPage: { '@id': siteEntityUrl('webpage') },
        datePublished: '2025-01-01T00:00:00+00:00',
        dateModified: STRUCTURED_DATA_MODIFIED_AT,
        inLanguage: locale,
      },
    ],
  }

  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
        }}
      />
      {/* LLM-friendly semantic hints */}
      {/* About: TradingGoose is a visual workflow platform for technical LLM-driven trading */}
      {/* Purpose: Connect market data, build custom indicators, trigger AI agent workflows on signals */}
      {/* Features: PineTS custom indicators, live market data, backtesting, workflow canvas, widget workspaces */}
      {/* Use cases: Algorithmic trading automation, indicator-based alerts, portfolio rebalancing, AI trade execution */}
    </>
  )
}
