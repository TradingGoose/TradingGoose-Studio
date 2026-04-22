import { cache } from 'react'
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { resolveGitHubBlogSourceConfig } from '@/lib/system-services/runtime'
import { normalizeHeadingText, textToSlug } from './heading-slugs'
import type { Post, PostFrontmatter, ResolvedAuthor, TOC } from './types'

/**
 * Blog content source configuration.
 *
 * Configure the GitHub Admin Service to fetch posts from a public GitHub repo
 * instead of local files. Format: "owner/repo" (e.g. "TradingGoose/blog").
 *
 * Expected structure (same for local and GitHub repo):
 *   my-post/
 *     index.md       ← post content (frontmatter + markdown)
 *     cover.png      ← cover image (referenced as image: "cover.png")
 *     diagram.png    ← inline image (referenced as ![](./diagram.png))
 *
 * All relative image paths (in frontmatter `image` and markdown `![](...)`)
 * are auto-resolved to raw.githubusercontent.com URLs.
 *
 * The GitHub token is optional for public repos, so the blog renderer reads
 * only the repository settings and never decrypts credentials during build.
 *
 * When no GitHub blog repository is configured, falls back to local filesystem at
 * app/(landing)/blog/content/.
 */
const LOCAL_CONTENT_DIR = path.join(process.cwd(), 'app/(landing)/blog/content')

/** Fetch fresh on every request — no ISR cache for blog content. */
const FETCH_OPTIONS: RequestInit = { cache: 'no-store' }

type GitHubBlogSource = {
  repository: string
  branch: string
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function rawGitHubUrl(source: GitHubBlogSource, filePath: string): string {
  return `https://raw.githubusercontent.com/${source.repository}/${source.branch}/${filePath}`
}

function calculateReadingTime(content: string): number {
  const wordsPerMinute = 200
  const numberOfWords = content.split(/\s/g).length
  return Math.ceil(numberOfWords / wordsPerMinute)
}

function extractTOC(content: string): TOC[] {
  const headingRegex = /^(#{2,4})\s+(.+)$/gm
  const toc: TOC[] = []
  let match: RegExpExecArray | null

  while ((match = headingRegex.exec(content)) !== null) {
    const depth = match[1].length
    const title = normalizeHeadingText(match[2].trim())
    const url = `#${textToSlug(title)}`
    toc.push({ title, url, depth })
  }

  return toc
}

function resolveAuthors(raw: PostFrontmatter['authors']): ResolvedAuthor[] {
  if (!raw || raw.length === 0) return []

  return raw.map((entry) => {
    const github = typeof entry === 'string' ? entry : entry.github
    const name = typeof entry === 'string' ? `@${entry}` : (entry.name ?? `@${entry.github}`)
    const x = typeof entry === 'string' ? undefined : entry.x

    return {
      github,
      name,
      avatar: `https://avatars.githubusercontent.com/${github}`,
      profileUrl: x ? `https://x.com/${x}` : `https://github.com/${github}`,
      x,
    }
  })
}

/**
 * Resolve image paths relative to the post's folder.
 * - Absolute URLs (https://...) are left as-is.
 * - Relative paths (cover.png, ./diagram.png) are resolved to the
 *   raw GitHub URL or kept relative for local mode.
 */
function resolveImageUrl(
  imagePath: string,
  postDir: string,
  source: GitHubBlogSource | null
): string {
  if (!imagePath) return ''
  if (/^https?:\/\//.test(imagePath)) return imagePath

  const clean = imagePath.replace(/^\.\//, '')

  if (source) {
    return rawGitHubUrl(source, `${postDir}/${clean}`)
  }

  // Local: serve from public or leave relative — for local dev the images
  // sit next to the markdown so we serve them via a catch-all or public dir
  return `/blog-images/${postDir.split('/').pop()}/${clean}`
}

/**
 * Rewrite relative image references inside markdown content so they point
 * to the correct absolute URL when served from GitHub.
 */
function resolveContentImages(
  content: string,
  postDir: string,
  source: GitHubBlogSource | null
): string {
  // Match ![alt](./path) and ![alt](path) but not ![alt](https://...)
  return content.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/|\/\/)\.?\/?([^)]+)\)/g,
    (_, alt, imgPath) => {
      const resolved = resolveImageUrl(imgPath, postDir, source)
      return `![${alt}](${resolved})`
    }
  )
}

function parsePost(
  slug: string,
  fileContent: string,
  postDir: string,
  source: GitHubBlogSource | null
): Post | null {
  const { data, content } = matter(fileContent)
  const frontmatter = data as PostFrontmatter
  const published = frontmatter.published ?? true

  if (!published) return null

  const resolvedImage = frontmatter.image
    ? resolveImageUrl(frontmatter.image, postDir, source)
    : ''
  const resolvedContent = resolveContentImages(content, postDir, source)

  return {
    ...frontmatter,
    slug,
    image: resolvedImage,
    content: resolvedContent,
    readingTime: calculateReadingTime(content),
    toc: extractTOC(content),
    published,
    authors: resolveAuthors(frontmatter.authors),
  }
}

// ---------------------------------------------------------------------------
// GitHub source
// ---------------------------------------------------------------------------

interface GitHubTreeItem {
  path: string
  type: string
}

async function fetchPostsFromGitHub(source: GitHubBlogSource): Promise<Post[]> {
  const treeUrl = `https://api.github.com/repos/${source.repository}/git/trees/${source.branch}?recursive=1`
  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }

  const treeRes = await fetch(treeUrl, {
    headers,
    ...FETCH_OPTIONS,
  })

  if (!treeRes.ok) {
    console.error(`[blog] Failed to fetch GitHub tree: ${treeRes.status}`)
    return []
  }

  const tree: { tree: GitHubTreeItem[] } = await treeRes.json()

  // Find index.md/index.mdx inside top-level folders: my-post/index.md
  const postFiles = tree.tree.filter(
    (item) => item.type === 'blob' && /^[^/]+\/index\.mdx?$/.test(item.path)
  )

  const posts = await Promise.all(
    postFiles.map(async (file) => {
      const res = await fetch(rawGitHubUrl(source, file.path), FETCH_OPTIONS)
      if (!res.ok) return null

      const text = await res.text()
      // my-post/index.md → slug: "my-post", dir: "my-post"
      const slug = file.path.split('/')[0]
      return parsePost(slug, text, slug, source)
    })
  )

  return posts
    .filter((p): p is Post => p !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ---------------------------------------------------------------------------
// Local filesystem source
// ---------------------------------------------------------------------------

function fetchPostsFromLocal(): Post[] {
  if (!fs.existsSync(LOCAL_CONTENT_DIR)) return []

  const entries = fs.readdirSync(LOCAL_CONTENT_DIR, { withFileTypes: true })

  const posts: (Post | null)[] = entries.map((entry) => {
    if (entry.isDirectory()) {
      // Folder-based: my-post/index.md
      const indexFile = ['index.md', 'index.mdx'].find((f) =>
        fs.existsSync(path.join(LOCAL_CONTENT_DIR, entry.name, f))
      )
      if (!indexFile) return null
      const filePath = path.join(LOCAL_CONTENT_DIR, entry.name, indexFile)
      const content = fs.readFileSync(filePath, 'utf-8')
      return parsePost(entry.name, content, entry.name, null)
    }
    if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      // Flat file fallback: my-post.md
      const filePath = path.join(LOCAL_CONTENT_DIR, entry.name)
      const content = fs.readFileSync(filePath, 'utf-8')
      const slug = entry.name.replace(/\.mdx?$/, '')
      return parsePost(slug, content, slug, null)
    }
    return null
  })

  return posts
    .filter((p): p is Post => p !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Deduplicate within a single server render pass (generateMetadata + page component)
export const getAllPosts = cache(async (): Promise<Post[]> => {
  try {
    const githubConfig = await resolveGitHubBlogSourceConfig()
    const repository = githubConfig.blogRepository

    if (!repository) {
      return fetchPostsFromLocal()
    }

    return fetchPostsFromGitHub({
      repository,
      branch: githubConfig.blogBranch,
    })
  } catch {
    console.warn('[blog] Failed to resolve GitHub blog settings, falling back to local content')
    return fetchPostsFromLocal()
  }
})

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const posts = await getAllPosts()
  return posts.find((post) => post.slug === slug) ?? null
}
