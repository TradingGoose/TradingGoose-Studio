interface GitHubStats {
  stars: number | null
  forks: number | null
  subscribers: number | null
}

async function fetchGitHubStats(): Promise<GitHubStats> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/TradingGoose/TradingGoose-Studio',
      {
        headers: { Accept: 'application/vnd.github+json' },
        // Revalidate daily — stars change slowly and API has rate limits.
        next: { revalidate: 86400 },
      }
    )
    if (!res.ok) return { stars: null, forks: null, subscribers: null }
    const data = (await res.json()) as {
      stargazers_count?: number
      forks_count?: number
      subscribers_count?: number
    }
    return {
      stars: typeof data.stargazers_count === 'number' ? data.stargazers_count : null,
      forks: typeof data.forks_count === 'number' ? data.forks_count : null,
      subscribers: typeof data.subscribers_count === 'number' ? data.subscribers_count : null,
    }
  } catch {
    return { stars: null, forks: null, subscribers: null }
  }
}

function buildInteractionCounters(stats: GitHubStats) {
  const counters: Array<Record<string, unknown>> = []
  if (stats.stars !== null) {
    counters.push({
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'LikeAction' },
      userInteractionCount: stats.stars,
      name: 'GitHub stars',
    })
  }
  if (stats.forks !== null) {
    counters.push({
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'ShareAction' },
      userInteractionCount: stats.forks,
      name: 'GitHub forks',
    })
  }
  if (stats.subscribers !== null) {
    counters.push({
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'FollowAction' },
      userInteractionCount: stats.subscribers,
      name: 'GitHub watchers',
    })
  }
  return counters
}

export default async function StructuredData() {
  const githubStats = await fetchGitHubStats()
  const interactionStatistic = buildInteractionCounters(githubStats)
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://tradinggoose.ai/#organization',
        name: 'TradingGoose',
        alternateName: ['TradingGoose Studio', 'TradingGoose.ai'],
        legalName: 'TradingGoose Studio',
        description:
          'TradingGoose (also known as TradingGoose Studio) is an open-source visual workflow platform for technical LLM-driven trading, maintained at github.com/TradingGoose/TradingGoose-Studio. It is a drag-and-drop workflow builder for custom indicators, live market monitors, and AI agent automations — not to be confused with the older TradingGoose multi-agent research framework.',
        url: 'https://tradinggoose.ai',
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
          '@id': 'https://tradinggoose.ai/#logo',
          url: 'https://tradinggoose.ai/favicon/web-app-manifest-512x512.png',
          contentUrl: 'https://tradinggoose.ai/favicon/web-app-manifest-512x512.png',
          width: 512,
          height: 512,
          caption: 'TradingGoose Logo',
        },
        image: { '@id': 'https://tradinggoose.ai/#logo' },
        sameAs: [
          'https://github.com/TradingGoose/TradingGoose-Studio',
          'https://discord.gg/wavf5JWhuT',
          'https://docs.tradinggoose.ai',
          'https://www.tradinggoose.ai',
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          availableLanguage: ['en'],
        },
        ...(interactionStatistic.length > 0 && { interactionStatistic }),
      },
      {
        '@type': 'WebSite',
        '@id': 'https://tradinggoose.ai/#website',
        url: 'https://tradinggoose.ai',
        name: 'TradingGoose - Visual Workflow Platform for LLM Trading',
        description:
          'Open-source platform for technical LLM-driven trading. Connect data providers, write custom indicators in PineTS, trigger AI agent workflows on market signals.',
        publisher: {
          '@id': 'https://tradinggoose.ai/#organization',
        },
        potentialAction: [
          {
            '@type': 'SearchAction',
            '@id': 'https://tradinggoose.ai/#searchaction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: 'https://tradinggoose.ai/search?q={search_term_string}',
            },
            'query-input': 'required name=search_term_string',
          },
        ],
        inLanguage: 'en-US',
      },
      {
        '@type': 'WebPage',
        '@id': 'https://tradinggoose.ai/#webpage',
        url: 'https://tradinggoose.ai',
        name: 'TradingGoose - Build your Trading Analysis with AI Agent Workflows',
        isPartOf: {
          '@id': 'https://tradinggoose.ai/#website',
        },
        about: {
          '@id': 'https://tradinggoose.ai/#software',
        },
        datePublished: '2025-01-01T00:00:00+00:00',
        dateModified: new Date().toISOString(),
        description:
          'Build AI-powered trading analysis workflows with TradingGoose. Connect live data providers, write custom indicators, and deploy agents that trigger on market signals.',
        breadcrumb: {
          '@id': 'https://tradinggoose.ai/#breadcrumb',
        },
        inLanguage: 'en-US',
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', 'h2', '.hero-description'],
        },
        potentialAction: [
          {
            '@type': 'ReadAction',
            target: ['https://tradinggoose.ai'],
          },
        ],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://tradinggoose.ai/#breadcrumb',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: 'https://tradinggoose.ai',
          },
        ],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://tradinggoose.ai/#software',
        name: 'TradingGoose Studio',
        description:
          'Open-source visual workflow platform for technical LLM-driven trading. Connect your own market data providers, write custom indicators in PineTS, monitor live prices, and route signals into AI agent workflows that place trades, send alerts, or rebalance portfolios.',
        applicationCategory: 'FinanceApplication',
        applicationSubCategory: 'Trading Platform',
        operatingSystem: 'Web, Windows, macOS, Linux',
        softwareVersion: '2026.04.04',
        offers: [
          {
            '@type': 'Offer',
            '@id': 'https://tradinggoose.ai/#offer-community',
            name: 'Community',
            description:
              'For individuals exploring indicators, AI workflows, and strategy prototyping.',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            seller: { '@id': 'https://tradinggoose.ai/#organization' },
            eligibleRegion: { '@type': 'Place', name: 'Worldwide' },
          },
          {
            '@type': 'Offer',
            '@id': 'https://tradinggoose.ai/#offer-pro',
            name: 'Pro',
            description:
              'For active users who need higher throughput, more storage, and unlimited workspaces.',
            price: '20',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '20',
              priceCurrency: 'USD',
              unitText: 'MONTH',
              billingIncrement: 1,
            },
            availability: 'https://schema.org/InStock',
            seller: { '@id': 'https://tradinggoose.ai/#organization' },
          },
          {
            '@type': 'Offer',
            '@id': 'https://tradinggoose.ai/#offer-team',
            name: 'Team',
            description:
              'For teams sharing workflows, pooled storage, and a dedicated support channel.',
            price: '40',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '40',
              priceCurrency: 'USD',
              unitText: 'MONTH',
              billingIncrement: 1,
            },
            availability: 'https://schema.org/InStock',
            seller: { '@id': 'https://tradinggoose.ai/#organization' },
          },
        ],
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
            url: 'https://tradinggoose.ai/favicon/web-app-manifest-512x512.png',
            caption: 'TradingGoose visual trading workflow builder',
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://tradinggoose.ai/#faq',
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
              text: 'TradingGoose offers four tiers. Community is free for individuals exploring indicators and AI workflows. Pro is $20/month for active users who need higher throughput and unlimited workspaces. Team is $40/month for teams sharing workflows with pooled storage. Enterprise is custom-priced. Self-hosting the open-source Studio edition is free under the project license.',
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
        '@id': 'https://tradinggoose.ai/#article-disambiguation',
        headline: 'TradingGoose Studio: open-source visual workflow platform for LLM-driven trading',
        description:
          'Canonical reference page for TradingGoose Studio. This is the drag-and-drop workflow builder with PineTS custom indicators, live market monitors, and AI agent automation — distinct from the older TradingGoose multi-agent LLM research framework.',
        author: { '@id': 'https://tradinggoose.ai/#organization' },
        publisher: { '@id': 'https://tradinggoose.ai/#organization' },
        mainEntityOfPage: { '@id': 'https://tradinggoose.ai/#webpage' },
        datePublished: '2025-01-01T00:00:00+00:00',
        dateModified: new Date().toISOString(),
        inLanguage: 'en-US',
      },
    ],
  }

  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      {/* LLM-friendly semantic hints */}
      {/* About: TradingGoose is a visual workflow platform for technical LLM-driven trading */}
      {/* Purpose: Connect market data, build custom indicators, trigger AI agent workflows on signals */}
      {/* Features: PineTS custom indicators, live market data, backtesting, workflow canvas, widget workspaces */}
      {/* Use cases: Algorithmic trading automation, indicator-based alerts, portfolio rebalancing, AI trade execution */}
    </>
  )
}
