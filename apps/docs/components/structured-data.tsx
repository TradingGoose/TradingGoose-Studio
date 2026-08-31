import Script from 'next/script'
import { docsLocaleCopy, type DocsLocale } from '@/lib/i18n'

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
  const copy = docsLocaleCopy[lang]

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
      name: copy.team,
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: 'TradingGoose',
      url: baseUrl,
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
      name: copy.siteName,
      url: baseUrl,
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
    description: copy.description,
    url: baseUrl,
    author: {
      '@type': 'Organization',
      name: copy.team,
    },
    offers: {
      '@type': 'Offer',
      category: copy.category,
    },
    featureList: [
      copy.documentation,
    ],
  }

  return (
    <>
      <Script
        id='article-structured-data'
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleStructuredData),
        }}
      />
      {breadcrumbStructuredData && (
        <Script
          id='breadcrumb-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumbStructuredData),
          }}
        />
      )}
      {faqStructuredData && (
        <Script
          id='faq-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqStructuredData),
          }}
        />
      )}
      {url === baseUrl && (
        <Script
          id='software-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareStructuredData),
          }}
        />
      )}
    </>
  )
}
