import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import BlogLayout from '@/app/(landing)/components/blog-layout'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { getOpenGraphLocale, locales, localizePathname, localizeUrl } from '@/i18n/utils'
import FilteredPosts from './components/filtered-posts'
import PageHeading from './components/page-heading'
import { getAllPosts } from './lib/posts'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as (typeof locales)[number]
  const copy = getPublicCopy(locale)
  const canonicalPath = '/blog'
  const localizedCanonicalPath = localizePathname(locale, canonicalPath)
  const canonicalUrl = localizeUrl('https://tradinggoose.ai', locale, canonicalPath)

  return {
    title: copy.meta.blog.title,
    description: copy.meta.blog.description,
      alternates: {
        canonical: localizedCanonicalPath,
        languages: {
          'x-default': 'https://tradinggoose.ai/blog',
          en: 'https://tradinggoose.ai/blog',
          es: 'https://tradinggoose.ai/es/blog',
          'zh-CN': localizeUrl('https://tradinggoose.ai', 'zh-CN', '/blog'),
        },
      },
    openGraph: {
      title: copy.meta.blog.title,
      description: copy.meta.blog.description,
      url: canonicalUrl,
      locale: getOpenGraphLocale(locale),
      alternateLocale: locales.filter((value) => value !== locale).map(getOpenGraphLocale),
    },
    twitter: {
      card: 'summary',
      title: copy.meta.blog.title,
      description: copy.meta.blog.description,
    },
  }
}

export default async function BlogPage() {
  const locale = (await getLocale()) as (typeof locales)[number]
  const copy = getPublicCopy(locale)
  const posts = await getAllPosts(locale)

  return (
    <BlogLayout path='/blog'>
      <PageHeading
        title={copy.blog.pageTitle}
        description={formatTemplate(copy.blog.pageDescription, { count: posts.length })}
      />
      <FilteredPosts posts={posts} />
    </BlogLayout>
  )
}
