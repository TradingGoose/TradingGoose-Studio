'use client'

import { useState } from 'react'
import { FileText, SearchIcon, SearchX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import PostCard from './post-card'
import type { Post } from '../lib/types'

interface FilteredPostProps {
  posts: Post[]
}

export default function FilteredPosts({ posts }: FilteredPostProps) {
  const [searchValue, setSearchValue] = useState('')

  if (posts.length === 0) {
    return (
      <Empty className="my-24">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>No posts yet</EmptyTitle>
          <EmptyDescription>Check back soon — new articles are on the way.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const filteredPosts = posts.filter((post) =>
    post.title.toLowerCase().includes(searchValue.toLowerCase())
  )

  return (
    <>
      <div className="relative my-8">
        <Input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search articles"
          aria-label="Search articles"
          className="w-full pl-12"
          id="search"
        />
        <Label htmlFor="search">
          <SearchIcon className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        </Label>
      </div>

      {filteredPosts.length > 0 ? (
        <div className="grid gap-10 lg:grid-cols-2">
          {filteredPosts.map((post, index) => (
            <PostCard key={post.slug} post={post} index={index} />
          ))}
        </div>
      ) : (
        <Empty className="my-24">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No posts matching &ldquo;{searchValue}&rdquo;</EmptyTitle>
            <EmptyDescription>Try a different search term.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  )
}
