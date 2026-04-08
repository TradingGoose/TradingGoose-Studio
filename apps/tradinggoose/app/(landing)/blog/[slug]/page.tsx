import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { BlogLayout } from '@/app/(landing)/components'
import { getPostBySlug } from '../lib/posts'
import { plainTitle, splitTitle, formatBlogDate } from '../lib/heading-slugs'
import BreadcrumbNav from '../components/breadcrumb-nav'
import MarkdownContent from '../components/markdown-content'
import TableOfContents from '../components/table-of-contents'
import SocialShare from '../components/social-share'
import AiSummarize from '../components/ai-summarize'

interface PostPageProps {
  params: Promise<{ slug: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return {}

  const metaTitle = plainTitle(post.title)

  return {
    title: `${metaTitle} | TradingGoose Blog`,
    description: post.description,
    openGraph: {
      title: metaTitle,
      description: post.description,
      type: 'article',
      images: post.image ? [{ url: post.image, width: 1200, height: 630, alt: metaTitle }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: metaTitle,
      description: post.description,
      images: post.image ? [post.image] : [],
    },
  }
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) notFound()

  const { title, date, image, authors, tags, toc, content, readingTime } = post
  const postUrl = `https://tradinggoose.ai/blog/${slug}`
  const cleanTitle = plainTitle(title)
  const titleLines = splitTitle(title)

  return (
    <BlogLayout path={`/blog/${slug}`} title={cleanTitle}>
      <article>
        <BreadcrumbNav pageTitle={cleanTitle} />

        <h1 className="mt-2 inline-block text-4xl font-bold leading-tight lg:text-5xl">
          {titleLines.map((line, i) => (
            <span key={i}>
              {line}
              {i < titleLines.length - 1 && <br />}
            </span>
          ))}
        </h1>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-y-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            {authors?.length
              ? authors.map((author) => (
                <Link
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
                </Link>
              ))
              : null}
            <span className="text-muted-foreground/50">·</span>
            {date && <time dateTime={date}>{formatBlogDate(date)}</time>}
            <span className="text-muted-foreground/50">·</span>
            <div className="flex items-center gap-1">
              <Clock className="size-3.5" />
              <span>{readingTime} min read</span>
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
            alt={cleanTitle}
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
              <SocialShare text={title} url={postUrl} />
              <Separator className="my-4" />
              <AiSummarize url={postUrl} title={title} />
              <Separator className="my-4" />
              <TableOfContents toc={toc} />
            </div>
          </div>
        </div>
      </article>
    </BlogLayout>
  )
}
