import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import BlogLayout from '@/app/(landing)/components/blog-layout'
import { getPublicCopy } from '@/i18n/public-copy'
import {
  buildLocalizedAlternates,
  getOpenGraphLocale,
  localizeSiteUrl,
  type LocaleCode,
} from '@/i18n/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import { getPostBySlug } from '@/app/(landing)/blog/lib/posts'
import { formatBlogDate } from '@/app/(landing)/blog/lib/heading-slugs'
import BreadcrumbNav from '@/app/(landing)/blog/components/breadcrumb-nav'
import MarkdownTitle from '@/app/(landing)/blog/components/markdown-title'
import MarkdownContent from '@/app/(landing)/blog/components/markdown-content'
import TableOfContents from '@/app/(landing)/blog/components/table-of-contents'
import SocialShare from '@/app/(landing)/blog/components/social-share'
import AiSummarize from '@/app/(landing)/blog/components/ai-summarize'

interface PostPageProps {
  params: Promise<{ slug: string }>
}

export const dynamic = 'force-dynamic'

/** Strip markdown link syntax for meta tags: [text](url) → text */
function toPlainTitle(md: string): string {
  return md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n/g, ' ').trim()
}

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return {}

  // Plain-text title for <title>, og:title, twitter:title — browsers & social
  // platforms don't render Markdown, so strip link syntax for clean display.
  // The visible H1 still renders the full Markdown via MarkdownTitle.
  const plainTitle = toPlainTitle(post.title)

  return {
    title: `${plainTitle} | ${copy.blog.pageTitle}`,
    description: post.description,
    alternates: buildLocalizedAlternates(locale, `/blog/${slug}`),
    openGraph: {
      title: plainTitle,
      description: post.description,
      type: 'article',
      url: localizeSiteUrl(locale, `/blog/${slug}`),
      locale: getOpenGraphLocale(locale),
      images: post.image ? [{ url: post.image, width: 1200, height: 630, alt: plainTitle }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: plainTitle,
      description: post.description,
      images: post.image ? [post.image] : [],
    },
  }
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) notFound()
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const siteBaseUrl = getBaseUrl()

  const { title, date, image, authors, tags, toc, content, readingTime } = post
  const postPath = `/blog/${slug}`

  const plainTitle = toPlainTitle(title)
  const wordCount = content.split(/\s+/).length
  const blogPostingSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: plainTitle,
    description: post.description,
    ...(image && { image }),
    datePublished: date ? new Date(date).toISOString() : undefined,
    wordCount,
    timeRequired: `PT${readingTime}M`,
    url: localizeSiteUrl(locale, postPath),
    ...(authors?.length && {
      author: authors.map((a) => ({
        '@type': 'Person',
        name: a.name,
        url: a.profileUrl,
        image: a.avatar,
        sameAs: [
          `https://github.com/${a.github}`,
          ...(a.x ? [`https://x.com/${a.x}`] : []),
        ],
      })),
    }),
    publisher: { '@id': `${siteBaseUrl}/#organization` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': localizeSiteUrl(locale, postPath) },
    ...(tags?.length && { keywords: tags.join(', '), articleSection: tags[0] }),
    inLanguage: locale,
  }

  return (
    <BlogLayout path={`/blog/${slug}`} title={plainTitle}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingSchema).replace(/</g, '\\u003c') }}
      />
      <article>
        <BreadcrumbNav pageTitle={title} />

        <MarkdownTitle
          title={title}
          as="h1"
          className="mt-2 inline-block text-4xl font-bold leading-tight lg:text-5xl"
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-y-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            {authors?.length
              ? authors.map((author) => (
                <a
                  key={author.github}
                  href={author.profileUrl}
                  className="flex items-center gap-2"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={author.avatar} alt={author.name} />
                    <AvatarFallback className="text-xs">
                      {author.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-foreground">{author.name}</span>
                </a>
              ))
              : null}
            <span className="text-muted-foreground/50">·</span>
            {date && <time dateTime={date}>{formatBlogDate(date, 'long', locale)}</time>}
            <span className="text-muted-foreground/50">·</span>
            <div className="flex items-center gap-1">
              <Clock className="size-3.5" />
              <span>
                {readingTime} {copy.blog.readTimeSuffix}
              </span>
            </div>
          </div>

          {tags && tags.length > 0 && (
            <ul className="m-0 flex list-none gap-2 p-0">
              {tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="secondary">{tag}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {image && (
          <Image
            src={image}
            alt={title}
            width={1200}
            height={600}
            className="my-8 h-auto w-full rounded-md border bg-muted transition-colors"
            priority
          />
        )}

        {/* Two-column: content + TOC */}
        <div className="relative lg:gap-10 xl:grid xl:grid-cols-[1fr_250px]">
          <div className="w-full min-w-0">
            <MarkdownContent content={content} />
          </div>

          <div className="hidden text-sm xl:block">
            <div className="sticky top-10 max-h-[calc(100vh-4rem)] pt-4">
              <SocialShare text={title} path={postPath} />
              <Separator className="my-4" />
              <AiSummarize path={postPath} title={title} />
              <Separator className="my-4" />
              <TableOfContents toc={toc} />
            </div>
          </div>
        </div>
      </article>
    </BlogLayout>
  )
}
