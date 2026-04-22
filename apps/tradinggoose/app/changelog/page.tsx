import type { Metadata } from 'next'
import ChangelogContent from './components/changelog-content'

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Stay up-to-date with the latest features, improvements, and bug fixes in TradingGoose.',
  alternates: {
    canonical: 'https://tradinggoose.ai/changelog',
    types: {
      'application/rss+xml': '/changelog.xml',
    },
  },
  openGraph: {
    title: 'Changelog',
    description:
      'Stay up-to-date with the latest features, improvements, and bug fixes in TradingGoose.',
    type: 'website',
  },
}

const changelogStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle',
      headline: 'TradingGoose Studio Changelog',
      description:
        'Release notes, new features, improvements, and fixes for TradingGoose Studio.',
      url: 'https://tradinggoose.ai/changelog',
      mainEntityOfPage: 'https://tradinggoose.ai/changelog',
      inLanguage: 'en-US',
      author: { '@id': 'https://tradinggoose.ai/#organization' },
      publisher: { '@id': 'https://tradinggoose.ai/#organization' },
      about: { '@id': 'https://tradinggoose.ai/#software' },
      isPartOf: { '@id': 'https://tradinggoose.ai/#website' },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://tradinggoose.ai',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Changelog',
          item: 'https://tradinggoose.ai/changelog',
        },
      ],
    },
  ],
}

export default function ChangelogPage() {
  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(changelogStructuredData) }}
      />
      <ChangelogContent />
    </>
  )
}
