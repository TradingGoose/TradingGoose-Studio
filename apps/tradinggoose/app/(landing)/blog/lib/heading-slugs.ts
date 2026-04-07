/**
 * Shared heading slug generation for TOC extraction and markdown rendering.
 * Both posts.ts (server) and markdown-content.tsx (client) use the same
 * algorithm so heading IDs and TOC anchor links always match.
 */

/**
 * Strip markdown formatting from heading text to get plain text.
 * Removes bold (**text**), italic (*text*), code (`text`), links, etc.
 */
export function normalizeHeadingText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/`(.+?)`/g, '$1') // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .trim()
}

/**
 * Flatten React node children to a plain text string.
 * Used by the client-side markdown renderer.
 */
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

/**
 * Create a stateful slug generator that handles duplicate headings by
 * appending a counter suffix (e.g. "intro", "intro-1", "intro-2").
 *
 * Must create a new instance per document render so counters reset.
 */
export function createHeadingSlugger() {
  const counts = new Map<string, number>()

  return function slug(text: string): string {
    const base = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')

    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)

    return count === 0 ? base : `${base}-${count}`
  }
}
