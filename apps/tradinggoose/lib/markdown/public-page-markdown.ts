import { getPublicBillingCatalog } from '@/lib/billing/catalog'
import { buildHostedPricingSentence } from '@/lib/billing/public-catalog'
import { DEFAULT_META_DESCRIPTION } from '@/lib/branding/metadata'
import { convertHtmlToMarkdown } from '@/lib/markdown/html-to-markdown'
import { getAllPosts, getPostBySlug } from '@/app/(landing)/blog/lib/posts'

interface MarkdownDocumentOptions {
  title: string
  url: string
  body: string
  description?: string
}

function escapeFrontmatterValue(value: string): string {
  return JSON.stringify(value)
}

function buildMarkdownDocument({ title, url, body, description }: MarkdownDocumentOptions): string {
  const frontmatterLines = [
    '---',
    `title: ${escapeFrontmatterValue(title)}`,
    `url: ${escapeFrontmatterValue(url)}`,
  ]

  if (description) {
    frontmatterLines.push(`description: ${escapeFrontmatterValue(description)}`)
  }

  frontmatterLines.push('---')

  const frontmatter = `${frontmatterLines.join('\n')}\n\n`

  return `${frontmatter}${body.trim()}\n`
}

function plainTextTitle(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n/g, ' ')
    .trim()
}

async function buildHomepageMarkdown(origin: string): Promise<string> {
  const billingCatalog = await getPublicBillingCatalog()
  const hostedPricingSentence = billingCatalog.billingEnabled
    ? buildHostedPricingSentence(billingCatalog)
    : ''

  const body = `# TradingGoose

${DEFAULT_META_DESCRIPTION}

TradingGoose is an open-source visual workflow platform built for technical LLM-driven trading.
It lets you connect your own market data providers, write custom indicators in PineTS, monitor
live prices, and route signals into AI agent workflows that trigger trades, alerts, portfolio
rebalances, or any action you define.

TradingGoose Studio is the open-source core, maintained at
https://github.com/tradinggoose/tradinggoose-studio. Self-hosting is supported.
${
  billingCatalog.billingEnabled
    ? `The hosted edition at tradinggoose.ai offers ${hostedPricingSentence || 'managed cloud tiers'}.`
    : 'Hosted billing is currently disabled.'
}

## What it is

- Visual workflow canvas for trading strategies
- Widget-based workspace with split panels and saved layouts
- Custom indicator editor using PineTS
- Live market monitors that fire triggers on signals
- AI agent workflows that can trade, alert, rebalance, or call tools
- Backtesting against historical candle data

## Getting started

- Documentation: https://docs.tradinggoose.ai
- GitHub: https://github.com/TradingGoose/TradingGoose-Studio
- Sign up: ${origin}/signup
- Changelog: ${origin}/changelog
- Pricing and plans: ${origin}

## Community

- Discord: https://discord.gg/wavf5JWhuT
- X / Twitter: https://x.com/tradinggoose
`

  return buildMarkdownDocument({
    title: 'TradingGoose - Visual Workflow Platform for Technical LLM Trading',
    description: DEFAULT_META_DESCRIPTION,
    url: `${origin}/`,
    body,
  })
}

async function buildBlogIndexMarkdown(origin: string): Promise<string> {
  const posts = await getAllPosts()
  const lines = posts.map((post) => {
    const title = plainTextTitle(post.title)
    const description = post.description ? ` — ${post.description}` : ''
    return `- [${title}](${origin}/blog/${post.slug}) (${post.date})${description}`
  })

  const body = `# TradingGoose Blog

Articles about trading automation, workflow design, and building smarter strategies.

## Posts

${lines.join('\n')}
`

  return buildMarkdownDocument({
    title: 'Blog | TradingGoose',
    description:
      'Articles about trading automation, workflow design, and building smarter strategies.',
    url: `${origin}/blog`,
    body,
  })
}

async function buildBlogPostMarkdown(origin: string, pathname: string): Promise<string | null> {
  const slug = pathname.replace(/^\/blog\//, '')
  const post = await getPostBySlug(slug)

  if (!post) {
    return null
  }

  const title = plainTextTitle(post.title)
  const metadataLines = [
    `- Published: ${post.date}`,
    post.authors.length > 0
      ? `- Authors: ${post.authors.map((author) => author.name).join(', ')}`
      : null,
    post.tags?.length ? `- Tags: ${post.tags.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const body = `# ${title}

${post.description || ''}

${metadataLines}

${post.content.trim()}
`

  return buildMarkdownDocument({
    title,
    description: post.description,
    url: `${origin}${pathname}`,
    body,
  })
}

async function buildChangelogMarkdown(origin: string): Promise<string> {
  let releases: any[] = []

  try {
    const response = await fetch(
      'https://api.github.com/repos/tradinggoose/tradinggoose-studio/releases?per_page=10&page=1',
      {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      }
    )

    releases = response.ok ? await response.json() : []
  } catch {
    releases = []
  }

  const entries = releases
    .filter((release) => !release.prerelease)
    .map((release) => {
      const heading = `## ${release.name || release.tag_name}`
      const meta = [
        `- Tag: ${release.tag_name}`,
        `- Published: ${release.published_at}`,
        `- URL: ${release.html_url}`,
      ]
      const body = String(release.body || '').trim() || 'No release notes provided.'
      return `${heading}\n\n${meta.join('\n')}\n\n${body}`
    })
    .join('\n\n')

  const body = `# Changelog

Stay up-to-date with the latest features, improvements, and bug fixes in TradingGoose.

${entries || 'No changelog entries are available right now.'}
`

  return buildMarkdownDocument({
    title: 'Changelog',
    description:
      'Stay up-to-date with the latest features, improvements, and bug fixes in TradingGoose.',
    url: `${origin}/changelog`,
    body,
  })
}

async function buildConvertedPageMarkdown(
  origin: string,
  pathname: string
): Promise<string | null> {
  const sourceUrl = new URL(pathname, origin)
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'text/html',
      'x-tradinggoose-markdown-bypass': '1',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    return null
  }

  const html = await response.text()
  const converted = convertHtmlToMarkdown(html, {
    sourceUrl: sourceUrl.toString(),
  })

  if (!converted.body) {
    return null
  }

  return buildMarkdownDocument({
    title: converted.title || `TradingGoose ${pathname}`,
    description: converted.description,
    url: sourceUrl.toString(),
    body: converted.body,
  })
}

export async function renderPublicPageMarkdown(
  origin: string,
  pathname: string
): Promise<string | null> {
  switch (pathname) {
    case '/':
      return buildHomepageMarkdown(origin)
    case '/blog':
      return buildBlogIndexMarkdown(origin)
    case '/changelog':
      return buildChangelogMarkdown(origin)
    default:
      if (pathname.startsWith('/blog/')) {
        return buildBlogPostMarkdown(origin, pathname)
      }

      return buildConvertedPageMarkdown(origin, pathname)
  }
}
