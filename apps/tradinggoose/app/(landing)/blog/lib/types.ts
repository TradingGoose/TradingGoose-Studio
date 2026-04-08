export interface PostFrontmatter {
  title: string
  description?: string
  published?: boolean
  date: string
  image: string
  tags?: string[]
  /**
   * Post authors. Can be:
   *
   * Simple (GitHub username only — avatar from GitHub, profile links to GitHub):
   *   authors: ["BWJ2310"]
   *
   * With overrides:
   *   authors:
   *     - github: "BWJ2310"
   *       name: "TradingGoose Team"
   *       x: "tradinggoose"       # optional, X/Twitter handle
   */
  authors?: (string | { github: string; name?: string; x?: string })[]
}

export interface ResolvedAuthor {
  github: string
  name: string
  avatar: string
  profileUrl: string
  x?: string
}

export interface Post extends Omit<PostFrontmatter, 'authors'> {
  slug: string
  content: string
  readingTime: number
  toc: TOC[]
  authors: ResolvedAuthor[]
}

export interface TOC {
  title: string
  url: string
  depth: number
}
