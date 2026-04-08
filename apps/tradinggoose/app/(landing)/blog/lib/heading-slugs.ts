/**
 * Shared heading utilities for TOC extraction (server) and markdown rendering (client).
 */

export function normalizeHeadingText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

export function textToSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

export function flattenNodeText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenNodeText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as { props: { children?: React.ReactNode } }
    return flattenNodeText(el.props.children)
  }
  return ''
}

const TITLE_BR_REGEX = /<br\s*\/?>/gi

/** Strip `<br>` tags and newlines from a title for use in metadata/breadcrumbs. */
export function plainTitle(title: string): string {
  return title.replace(TITLE_BR_REGEX, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

const TITLE_SPLIT_REGEX = /<br\s*\/?>|\n/

/** Split a title on `<br>` or newline for multiline rendering. */
export function splitTitle(title: string): string[] {
  return title.split(TITLE_SPLIT_REGEX).map((s) => s.trim()).filter(Boolean)
}

export function formatBlogDate(dateStr: string, style: 'long' | 'short' = 'long'): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
