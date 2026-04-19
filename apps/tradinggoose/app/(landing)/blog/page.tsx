import { Metadata } from 'next'
import BlogLayout from '@/app/(landing)/components/blog-layout'
import { getAllPosts } from './lib/posts'
import PageHeading from './components/page-heading'
import FilteredPosts from './components/filtered-posts'

export const metadata: Metadata = {
  title: 'Blog | TradingGoose',
  description: 'Articles about trading automation, workflow design, and building smarter strategies.',
  alternates: {
    canonical: '/blog',
  },
}

export default async function BlogPage() {
  const posts = await getAllPosts()

  return (
    <BlogLayout path="/blog">
      <PageHeading
        title="Blog"
        description={`Insights on trading automation, workflow design, and building smarter strategies. ${posts.length} articles and counting.`}
      />
      <FilteredPosts posts={posts} />
    </BlogLayout>
  )
}
