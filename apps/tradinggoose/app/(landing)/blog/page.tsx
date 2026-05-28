import { type Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import BlogLayout from '@/app/(landing)/components/blog-layout'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import {
  buildLocalizedAlternates,
  getOpenGraphLocale,
  localizeSiteUrl,
  type LocaleCode,
} from '@/i18n/utils'
import { getAllPosts } from './lib/posts'
import PageHeading from './components/page-heading'
import FilteredPosts from './components/filtered-posts'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)

  return {
    title: copy.meta.blog.title,
    description: copy.meta.blog.description,
    alternates: buildLocalizedAlternates(locale, '/blog'),
    openGraph: {
      title: copy.meta.blog.title,
      description: copy.meta.blog.description,
      type: 'website',
      url: localizeSiteUrl(locale, '/blog'),
      locale: getOpenGraphLocale(locale),
    },
  }
}

export default async function BlogPage() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const posts = await getAllPosts()

  return (
    <BlogLayout path="/blog">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Blog',
            name: copy.blog.pageTitle,
            description: copy.meta.blog.description,
            url: localizeSiteUrl(locale, '/blog'),
          }).replace(/</g, '\\u003c'),
        }}
      />
      <PageHeading
        title={copy.blog.pageTitle}
        description={formatTemplate(copy.blog.pageDescription, { count: posts.length })}
      />
      <FilteredPosts posts={posts} />
    </BlogLayout>
  )
}
