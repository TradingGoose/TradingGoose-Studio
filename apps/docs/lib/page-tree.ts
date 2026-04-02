import type * as PageTree from 'fumadocs-core/page-tree'

export function normalizeKey(value?: string | null) {
  if (!value) return undefined
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function normalizePath(value?: string | null) {
  if (!value) return undefined
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function slugifySegment(segment?: string | null) {
  if (!segment) return undefined
  return normalizeKey(segment.replace(/\.[^/.]+$/, ''))
}

function slugFromUrl(url?: string | null) {
  if (!url) return undefined
  const parts = url.split('/').filter(Boolean)
  if (parts.length === 0) return undefined
  return slugifySegment(parts[parts.length - 1])
}

function slugFromMetaPath(path?: string | null) {
  const normalized = normalizePath(path)
  if (!normalized) return undefined
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return undefined

  const last = parts[parts.length - 1]
  if (last?.startsWith('meta.')) {
    const candidate = parts[parts.length - 2]
    return slugifySegment(candidate)
  }

  return slugifySegment(last)
}

function slugFromPath(path?: string | null) {
  const normalized = normalizePath(path)
  if (!normalized) return undefined
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return undefined
  return slugifySegment(parts[parts.length - 1])
}

export function getPageSlug(item: PageTree.Item): string | undefined {
  return (
    slugFromUrl(item.url) ??
    slugFromPath(item.$id) ??
    slugFromPath(item.$ref?.file) ??
    (typeof item.name === 'string' ? normalizeKey(item.name) : undefined)
  )
}

export function getFolderSlug(folder: PageTree.Folder): string | undefined {
  return (
    slugFromUrl(folder.index?.url) ??
    slugFromMetaPath(folder.$ref?.metaFile) ??
    slugFromPath(folder.$id) ??
    (typeof folder.name === 'string' ? normalizeKey(folder.name) : undefined)
  )
}

export const supportedLanguages = ['en', 'es', 'zh'] as const

export function humanizeSlug(value: string) {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function folderMatchesSlug(folder: PageTree.Folder, slug: string) {
  const folderSlug = getFolderSlug(folder)
  if (folderSlug && folderSlug === slug) return true
  if (typeof folder.name === 'string' && normalizeKey(folder.name) === slug) return true
  return false
}

export function findFolderBySegments(
  tree: PageTree.Root,
  segments: string[],
): PageTree.Folder | null {
  const path = findFolderPathBySegments(tree, segments)
  if (!path || path.length === 0) return null
  return path[path.length - 1]
}

export function findFolderPathBySegments(
  parent: PageTree.Root | PageTree.Folder,
  segments: string[],
): PageTree.Folder[] | null {
  if (segments.length === 0) return null

  let currentChildren = parent.children
  const path: PageTree.Folder[] = []

  for (const segment of segments) {
    const normalizedSegment = normalizeKey(segment)
    if (!normalizedSegment) return null

    const match = currentChildren.find(
      (node): node is PageTree.Folder =>
        node.type === 'folder' && folderMatchesSlug(node, normalizedSegment),
    )

    if (!match) return null
    path.push(match)
    currentChildren = match.children
  }

  return path
}


function trimSlashes(value?: string | null) {
  if (!value) return ''
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

function findFirstPageUrl(folder: PageTree.Folder): string | undefined {
  if (folder.index?.url) return folder.index.url

  for (const child of folder.children) {
    if (child.type === 'page') {
      return child.url
    }
    if (child.type === 'folder') {
      const nested = findFirstPageUrl(child)
      if (nested) return nested
    }
  }

  return undefined
}

export function getFolderHref(folder: PageTree.Folder): string | undefined {
  if (folder.index?.url) return folder.index.url

  const slug = getFolderSlug(folder)
  if (!slug) return undefined

  const descendantUrl = findFirstPageUrl(folder)
  if (!descendantUrl) return undefined

  const segments = trimSlashes(descendantUrl).split('/').filter(Boolean)
  const slugIndex = segments.lastIndexOf(slug)
  if (slugIndex === -1) return undefined

  const targetSegments = segments.slice(0, slugIndex + 1)
  if (targetSegments.length === 0) return undefined

  return `/${targetSegments.join('/')}`
}
