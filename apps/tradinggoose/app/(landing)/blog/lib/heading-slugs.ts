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

export function formatBlogDate(dateStr: string, style: 'long' | 'short' = 'long'): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
