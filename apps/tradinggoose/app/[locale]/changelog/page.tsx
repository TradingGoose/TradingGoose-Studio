import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { getPublicCopy } from '@/i18n/public-copy'
import {
  buildLocalizedAlternates,
  getOpenGraphLocale,
  localizeSiteUrl,
  type LocaleCode,
} from '@/i18n/utils'
import ChangelogContent from '@/app/changelog/components/changelog-content'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)

  return {
    title: copy.meta.changelog.title,
    description: copy.meta.changelog.description,
    alternates: {
      ...buildLocalizedAlternates(locale, '/changelog'),
      types: {
        'application/rss+xml': '/changelog.xml',
      },
    },
    openGraph: {
      title: copy.meta.changelog.title,
      description: copy.meta.changelog.description,
      type: 'website',
      url: localizeSiteUrl(locale, '/changelog'),
      locale: getOpenGraphLocale(locale),
    },
  }
}

export default async function ChangelogPage() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const changelogStructuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: copy.changelog.headline,
        description: copy.changelog.description,
        url: localizeSiteUrl(locale, '/changelog'),
        mainEntityOfPage: localizeSiteUrl(locale, '/changelog'),
        inLanguage: locale,
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
            name: copy.nav.homeLabel,
            item: localizeSiteUrl(locale, '/'),
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: copy.changelog.breadcrumb,
            item: localizeSiteUrl(locale, '/changelog'),
          },
        ],
      },
    ],
  }

  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(changelogStructuredData) }}
      />
      <ChangelogContent copy={copy.changelog} locale={locale} />
    </>
  )
}
