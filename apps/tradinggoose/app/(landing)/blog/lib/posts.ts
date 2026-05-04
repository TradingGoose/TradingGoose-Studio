import { cache } from 'react'
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { resolveGitHubBlogSourceConfig } from '@/lib/system-services/runtime'
import { defaultLocale, isLocaleCode, type LocaleCode } from '@/i18n/utils'
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

type BlogPostCandidate = {
  slug: string
  locale?: LocaleCode
  filePath: string
  postDir: string
}

type BlogPostIndex = {
  source: GitHubBlogSource | null
  candidatesBySlug: Map<string, BlogPostCandidate[]>
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

function groupCandidatesBySlug(candidates: BlogPostCandidate[]) {
  const grouped = new Map<string, BlogPostCandidate[]>()

  for (const candidate of candidates) {
    const existing = grouped.get(candidate.slug) ?? []
    existing.push(candidate)
    grouped.set(candidate.slug, existing)
  }

  return grouped
}

function getLocaleSearchOrder(locale: LocaleCode) {
  return locale === defaultLocale ? [defaultLocale, undefined] : [locale, defaultLocale, undefined]
}

function resolveCandidate(
  candidates: BlogPostCandidate[],
  locale: LocaleCode
): BlogPostCandidate | undefined {
  const priority = getLocaleSearchOrder(locale)

  for (const candidateLocale of priority) {
    const match = candidates.find((candidate) => (candidate.locale ?? undefined) === candidateLocale)
    if (match) return match
  }

  return candidates[0]
}

function extractCandidateFromPath(filePath: string): BlogPostCandidate | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\/+/, '')
  const parts = normalized.split('/').filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  const last = parts[parts.length - 1]
  const parent = parts[parts.length - 2]
  const localeRoot = parts[0] === 'content' ? parts[1] : parts[0]

  if (/^index\.mdx?$/.test(last)) {
    if (!parent) {
      return null
    }

    const locale = isLocaleCode(localeRoot ?? '') ? (localeRoot as LocaleCode) : undefined
    const slug = locale && parts[0] === 'content' ? parts[2] : locale ? parts[1] : parent

    if (!slug) {
      return null
    }

    return {
      slug,
      locale,
      filePath,
      postDir: parts.slice(0, -1).join('/'),
    }
  }

  if (/\.mdx?$/.test(last)) {
    const slug = last.replace(/\.mdx?$/, '')
    const locale =
      isLocaleCode(localeRoot ?? '') && parts.length <= 2 ? (localeRoot as LocaleCode) : undefined

    return {
      slug,
      locale,
      filePath,
      postDir: parts.slice(0, -1).join('/'),
    }
  }

  return null
}

function collectLocalCandidates(
  directory: string,
  inheritedLocale?: LocaleCode,
  baseDir = directory
): BlogPostCandidate[] {
  if (!fs.existsSync(directory)) {
    return []
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const candidates: BlogPostCandidate[] = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!inheritedLocale && isLocaleCode(entry.name)) {
        candidates.push(...collectLocalCandidates(entryPath, entry.name, baseDir))
        continue
      }

      const indexFile = ['index.md', 'index.mdx'].find((filename) =>
        fs.existsSync(path.join(entryPath, filename))
      )

      if (indexFile) {
        candidates.push({
          slug: entry.name,
          locale: inheritedLocale,
          filePath: path.join(entryPath, indexFile),
          postDir: path.relative(baseDir, entryPath) || entry.name,
        })
        continue
      }

      candidates.push(...collectLocalCandidates(entryPath, inheritedLocale, baseDir))
      continue
    }

    if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      const candidate = extractCandidateFromPath(entryPath)
      if (candidate) {
        candidates.push({
          ...candidate,
          locale: inheritedLocale ?? candidate.locale,
        })
      }
    }
  }

  return candidates
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
// Blog index
// ---------------------------------------------------------------------------

interface GitHubTreeItem {
  path: string
  type: string
}

function createLocalBlogPostIndex(): BlogPostIndex {
  return {
    source: null,
    candidatesBySlug: groupCandidatesBySlug(collectLocalCandidates(LOCAL_CONTENT_DIR)),
  }
}

async function createGitHubBlogPostIndex(source: GitHubBlogSource): Promise<BlogPostIndex> {
  const treeUrl = `https://api.github.com/repos/${source.repository}/git/trees/${source.branch}?recursive=1`
  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }

  const treeRes = await fetch(treeUrl, {
    headers,
    ...FETCH_OPTIONS,
  })

  if (!treeRes.ok) {
    console.error(`[blog] Failed to fetch GitHub tree: ${treeRes.status}`)
    return { source, candidatesBySlug: new Map() }
  }

  const tree: { tree: GitHubTreeItem[] } = await treeRes.json()

  const candidates = tree.tree
    .filter((item) => item.type === 'blob' && /\.mdx?$/.test(item.path))
    .map((item) => extractCandidateFromPath(item.path))
    .filter((item): item is BlogPostCandidate => item !== null)

  return {
    source,
    candidatesBySlug: groupCandidatesBySlug(candidates),
  }
}

export const getBlogPostIndex = cache(async (): Promise<BlogPostIndex> => {
  try {
    const githubConfig = await resolveGitHubBlogSourceConfig()
    const repository = githubConfig.blogRepository

    if (!repository) {
      return createLocalBlogPostIndex()
    }

    return createGitHubBlogPostIndex({
      repository,
      branch: githubConfig.blogBranch,
    })
  } catch {
    console.warn('[blog] Failed to resolve GitHub blog settings, falling back to local content')
    return createLocalBlogPostIndex()
  }
})

export const getPostsFromIndex = cache(
  async (locale: LocaleCode, index: BlogPostIndex): Promise<Post[]> => {
    const posts = await Promise.all(
      [...index.candidatesBySlug.entries()].map(async ([slug, slugCandidates]) => {
        const candidate = resolveCandidate(slugCandidates, locale)
        if (!candidate) return null

        if (index.source) {
          const res = await fetch(rawGitHubUrl(index.source, candidate.filePath), FETCH_OPTIONS)
          if (!res.ok) return null

          const text = await res.text()
          return parsePost(slug, text, candidate.postDir, index.source)
        }

        const content = fs.readFileSync(candidate.filePath, 'utf-8')
        return parsePost(slug, content, candidate.postDir, null)
      })
    )

    return posts
      .filter((p): p is Post => p !== null)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Deduplicate within a single server render pass (generateMetadata + page component)
export const getAllPosts = cache(async (locale: LocaleCode = defaultLocale): Promise<Post[]> => {
  const index = await getBlogPostIndex()
  return getPostsFromIndex(locale, index)
})

export const getPostBySlug = cache(async (slug: string, locale: LocaleCode = defaultLocale) => {
  const posts = await getAllPosts(locale)
  return posts.find((post) => post.slug === slug) ?? null
})
