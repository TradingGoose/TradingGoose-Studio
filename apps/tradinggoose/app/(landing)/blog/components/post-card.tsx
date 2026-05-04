'use client'

import Image from 'next/image'
import { Clock } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBlogDate } from '../lib/heading-slugs'
import MarkdownTitle from './markdown-title'
import type { Post } from '../lib/types'
import { Link } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

interface PostCardProps {
  post: Post
  index: number
}

export default function PostCard({ post, index }: PostCardProps) {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)

  return (
    <Card className="group relative flex flex-col space-y-2 rounded-2xl border p-3">
      {post.image && (
        <div className="relative w-full">
          <Image
            src={post.image}
            alt={post.title}
            width={1200}
            height={630}
            className="aspect-[2/1] h-auto w-full rounded-xl border bg-muted object-cover transition-colors"
            priority={index <= 1}
          />
        </div>
      )}

      <div className="mt-2 flex h-full w-full flex-col gap-2">
        <MarkdownTitle
          title={post.title}
          as="h2"
          className="line-clamp-2 text-2xl font-extrabold"
        />
        {post.description && (
          <p className="line-clamp-3 text-muted-foreground sm:line-clamp-2 md:line-clamp-4">
            {post.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-sm text-muted-foreground">
          <span>{formatBlogDate(post.date, 'short', locale)}</span>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Clock className="size-4" />
              <span>
                {post.readingTime} {copy.blog.readTimeSuffix}
              </span>
            </div>

            {post.tags && post.tags.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {post.tags[0]}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Link href={`/blog/${post.slug}`} className="absolute inset-0">
        <span className="sr-only">{copy.blog.viewArticle}</span>
      </Link>
    </Card>
  )
}
