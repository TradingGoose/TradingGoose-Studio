export default function StructuredData() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://tradinggoose.ai/#organization',
        name: 'TradingGoose',
        alternateName: 'TradingGoose Studio',
        description:
          'Open-source AI agent workflow builder used by developers at trail-blazing startups to Fortune 500 companies',
        url: 'https://tradinggoose.ai',
        logo: {
          '@type': 'ImageObject',
          '@id': 'https://tradinggoose.ai/#logo',
          url: 'https://tradinggoose.ai/logo/b&w/text/b&w.svg',
          contentUrl: 'https://tradinggoose.ai/logo/b&w/text/b&w.svg',
          width: 49.78314,
          height: 24.276,
          caption: 'TradingGoose Logo',
        },
        image: { '@id': 'https://tradinggoose.ai/#logo' },
        sameAs: [
          'https://x.com/simdotai',
          'https://github.com/TradingGoose/TradingGoose-Studio',
          'https://www.linkedin.com/company/tradinggoose/',
          'https://discord.gg/Hr4UWYEcTT',
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          availableLanguage: ['en'],
        },
      },
      {
        '@type': 'WebSite',
        '@id': 'https://tradinggoose.ai/#website',
        url: 'https://tradinggoose.ai',
        name: 'TradingGoose - AI Agent Workflow Builder',
        description:
          'Open-source AI agent workflow builder. 50,000+ developers build and deploy agentic workflows. SOC2 and HIPAA compliant.',
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
        name: 'TradingGoose - Workflows for LLMs | Build AI Agent Workflows',
        isPartOf: {
          '@id': 'https://tradinggoose.ai/#website',
        },
        about: {
          '@id': 'https://tradinggoose.ai/#software',
        },
        datePublished: '2024-01-01T00:00:00+00:00',
        dateModified: new Date().toISOString(),
        description:
          'Build and deploy AI agent workflows with TradingGoose. Visual drag-and-drop interface for creating powerful LLM-powered automations.',
        breadcrumb: {
          '@id': 'https://tradinggoose.ai/#breadcrumb',
        },
        inLanguage: 'en-US',
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
        name: 'TradingGoose - AI Agent Workflow Builder',
        description:
          'Open-source AI agent workflow builder used by 50,000+ developers. Build agentic workflows with visual drag-and-drop interface. SOC2 and HIPAA compliant. Integrate with 100+ apps.',
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'AI Development Tools',
        operatingSystem: 'Web, Windows, macOS, Linux',
        softwareVersion: '1.0',
        offers: [
          {
            '@type': 'Offer',
            '@id': 'https://tradinggoose.ai/#offer-free',
            name: 'Community Plan',
            price: '0',
            priceCurrency: 'USD',
            priceValidUntil: '2025-12-31',
            itemCondition: 'https://schema.org/NewCondition',
            availability: 'https://schema.org/InStock',
            seller: {
              '@id': 'https://tradinggoose.ai/#organization',
            },
            eligibleRegion: {
              '@type': 'Place',
              name: 'Worldwide',
            },
          },
          {
            '@type': 'Offer',
            '@id': 'https://tradinggoose.ai/#offer-pro',
            name: 'Pro Plan',
            price: '20',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '20',
              priceCurrency: 'USD',
              unitText: 'MONTH',
              billingIncrement: 1,
            },
            priceValidUntil: '2025-12-31',
            itemCondition: 'https://schema.org/NewCondition',
            availability: 'https://schema.org/InStock',
            seller: {
              '@id': 'https://tradinggoose.ai/#organization',
            },
          },
          {
            '@type': 'Offer',
            '@id': 'https://tradinggoose.ai/#offer-team',
            name: 'Team Plan',
            price: '40',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '40',
              priceCurrency: 'USD',
              unitText: 'MONTH',
              billingIncrement: 1,
            },
            priceValidUntil: '2025-12-31',
            itemCondition: 'https://schema.org/NewCondition',
            availability: 'https://schema.org/InStock',
            seller: {
              '@id': 'https://tradinggoose.ai/#organization',
            },
          },
        ],
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.8',
          reviewCount: '150',
          bestRating: '5',
          worstRating: '1',
        },
        featureList: [
          'Visual workflow builder',
          'Drag-and-drop interface',
          '100+ integrations',
          'AI model support (OpenAI, Anthropic, Google, xAI, Mistral, Perplexity)',
          'Real-time collaboration',
          'Version control',
          'API access',
          'Custom functions',
          'Scheduled workflows',
          'Event triggers',
        ],
        screenshot: [
          {
            '@type': 'ImageObject',
            url: 'https://tradinggoose.ai/screenshots/workflow-builder.png',
            caption: 'TradingGoose workflow builder interface',
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
              text: 'TradingGoose is an open-source AI agent workflow builder used by 50,000+ developers at trail-blazing startups to Fortune 500 companies. It provides a visual drag-and-drop interface for building and deploying agentic workflows. TradingGoose is SOC2 and HIPAA compliant.',
            },
          },
          {
            '@type': 'Question',
            name: 'Which AI models does TradingGoose support?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'TradingGoose supports all major AI models including OpenAI (GPT-5, GPT-4o), Anthropic (Claude), Google (Gemini), xAI (Grok), Mistral, Perplexity, and many more. You can also connect to open-source models via Ollama.',
            },
          },
          {
            '@type': 'Question',
            name: 'Do I need coding skills to use TradingGoose?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No coding skills are required! TradingGoose features a visual drag-and-drop interface that makes it easy to build AI workflows. However, developers can also use custom functions and our API for advanced use cases.',
            },
          },
        ],
      },
    ],
  }

  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      {/* LLM-friendly semantic HTML comments */}
      {/* About: TradingGoose is a visual workflow builder for AI agents and large language models (LLMs) */}
      {/* Purpose: Enable users to create AI-powered automations without coding */}
      {/* Features: Drag-and-drop interface, 100+ integrations, multi-model support */}
      {/* Use cases: Email automation, chatbots, data analysis, content generation */}
    </>
  )
}
