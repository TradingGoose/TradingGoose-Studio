import type { DocsLocale } from '@/lib/i18n'

interface StructuredDataProps {
  title: string
  description: string
  url: string
  lang: DocsLocale
  dateModified?: string
  breadcrumb?: Array<{ name: string; url: string }>
}

export function StructuredData({
  title,
  description,
  url,
  lang,
  dateModified,
  breadcrumb,
}: StructuredDataProps) {
  const baseUrl = 'https://docs.tradinggoose.ai'
  const rootUrl = `${baseUrl}/${lang}`

  const articleStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description: description,
    url: url,
    datePublished: dateModified || new Date().toISOString(),
    dateModified: dateModified || new Date().toISOString(),
    author: {
      '@type': 'Organization',
      name: 'TradingGoose Team',
      url: rootUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: 'TradingGoose',
      url: rootUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/static/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    inLanguage: lang,
    isPartOf: {
      '@type': 'WebSite',
      name: 'TradingGoose Documentation',
      url: rootUrl,
    },
    potentialAction: {
      '@type': 'ReadAction',
      target: url,
    },
  }

  const breadcrumbStructuredData = breadcrumb && {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumb.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  const faqStructuredData = title.toLowerCase().includes('faq') && {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [],
  }

  const softwareStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'TradingGoose',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    description:
      'Visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.',
    url: rootUrl,
    author: {
      '@type': 'Organization',
      name: 'TradingGoose Team',
    },
    offers: {
      '@type': 'Offer',
      category: 'Developer Tools',
    },
    featureList: [
      'Visual workflow builder with drag-and-drop interface',
      'AI agent creation and automation',
      '80+ built-in integrations',
      'Real-time team collaboration',
      'Multiple deployment options',
      'Custom integrations via MCP protocol',
    ],
  }

  return (
    <>
      <script
        id='article-structured-data'
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleStructuredData).replace(/</g, '\\u003c'),
        }}
      />
      {breadcrumbStructuredData && (
        <script
          id='breadcrumb-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumbStructuredData).replace(/</g, '\\u003c'),
          }}
        />
      )}
      {faqStructuredData && (
        <script
          id='faq-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqStructuredData).replace(/</g, '\\u003c'),
          }}
        />
      )}
      {url === rootUrl && (
        <script
          id='software-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareStructuredData).replace(/</g, '\\u003c'),
          }}
        />
      )}
    </>
  )
}
