import path from 'node:path'

export type RouteOwnershipRule = {
  pattern: string
  defaultNamespace: string
  metadataNamespace?: string
  namespaces: string[]
}

export const EXPLICIT_ROUTE_OWNERSHIP_RULES: readonly RouteOwnershipRule[] = [
  {
    pattern: '/',
    defaultNamespace: 'landing',
    metadataNamespace: 'meta.landing',
    namespaces: ['landing', 'meta.landing'],
  },
  {
    pattern: '/blog',
    defaultNamespace: 'blog',
    metadataNamespace: 'meta.blog',
    namespaces: ['blog', 'meta.blog'],
  },
  {
    pattern: '/blog/[slug]',
    defaultNamespace: 'blog',
    metadataNamespace: 'meta.blog',
    namespaces: ['blog', 'meta.blog'],
  },
  {
    pattern: '/privacy',
    defaultNamespace: 'legal.privacy',
    metadataNamespace: 'meta.privacy',
    namespaces: ['legal.common', 'legal.privacy', 'meta.privacy'],
  },
  {
    pattern: '/terms',
    defaultNamespace: 'legal.terms',
    metadataNamespace: 'meta.terms',
    namespaces: ['legal.common', 'legal.terms', 'meta.terms'],
  },
  {
    pattern: '/licenses',
    defaultNamespace: 'legal',
    metadataNamespace: 'meta.licenses',
    namespaces: ['legal', 'meta.licenses'],
  },
  {
    pattern: '/careers',
    defaultNamespace: 'careers',
    metadataNamespace: 'meta.careers',
    namespaces: ['careers', 'meta.careers'],
  },
  {
    pattern: '/changelog',
    defaultNamespace: 'changelog',
    metadataNamespace: 'meta.changelog',
    namespaces: ['changelog', 'meta.changelog'],
  },
  {
    pattern: '/invite/[id]',
    defaultNamespace: 'invite',
    namespaces: ['invite'],
  },
  {
    pattern: '/unsubscribe',
    defaultNamespace: 'unsubscribe',
    namespaces: ['unsubscribe'],
  },
  {
    pattern: '/chat/[identifier]',
    defaultNamespace: 'chat',
    namespaces: ['chat'],
  },
  {
    pattern: '/workspace',
    defaultNamespace: 'workspace.entry',
    namespaces: ['workspace.entry'],
  },
  {
    pattern: '/workspace/[workspaceId]',
    defaultNamespace: 'workspace.dashboard',
    namespaces: ['workspace.dashboard'],
  },
  {
    pattern: '/workspace/[workspaceId]/dashboard',
    defaultNamespace: 'workspace.dashboard',
    namespaces: ['workspace.dashboard'],
  },
  {
    pattern: '/workspace/[workspaceId]/knowledge',
    defaultNamespace: 'workspace.knowledge',
    namespaces: ['workspace.knowledge'],
  },
  {
    pattern: '/workspace/[workspaceId]/files',
    defaultNamespace: 'workspace.files',
    namespaces: ['workspace.files'],
  },
  {
    pattern: '/workspace/[workspaceId]/records',
    defaultNamespace: 'workspace.records',
    namespaces: ['workspace.logs', 'workspace.records'],
  },
  {
    pattern: '/workspace/[workspaceId]/monitor',
    defaultNamespace: 'workspace.monitor',
    namespaces: ['workspace.monitor'],
  },
  {
    pattern: '/workspace/[workspaceId]/api-keys',
    defaultNamespace: 'workspace.apiKeys',
    namespaces: ['workspace.apiKeys'],
  },
  {
    pattern: '/workspace/[workspaceId]/integrations',
    defaultNamespace: 'workspace.integrations',
    namespaces: ['workspace.integrations'],
  },
  {
    pattern: '/workspace/[workspaceId]/environment',
    defaultNamespace: 'workspace.environment',
    namespaces: ['workspace.environment'],
  },
  {
    pattern: '/admin',
    defaultNamespace: 'admin.home',
    namespaces: ['admin.home'],
  },
  {
    pattern: '/admin/services',
    defaultNamespace: 'admin.services',
    namespaces: ['admin.services'],
  },
  {
    pattern: '/admin/integrations',
    defaultNamespace: 'admin.integrations',
    namespaces: ['admin.integrations'],
  },
  {
    pattern: '/admin/registration',
    defaultNamespace: 'admin.registration',
    namespaces: ['admin.registration'],
  },
  {
    pattern: '/admin/billing',
    defaultNamespace: 'admin.billing',
    namespaces: ['admin.billing'],
  },
  {
    pattern: '/admin/billing/create',
    defaultNamespace: 'admin.billing',
    namespaces: ['admin.billing'],
  },
  {
    pattern: '/admin/billing/[tierId]',
    defaultNamespace: 'admin.billing',
    namespaces: ['admin.billing'],
  },
  {
    pattern: '/login',
    defaultNamespace: 'auth.login',
    namespaces: ['auth.login'],
  },
  {
    pattern: '/signup',
    defaultNamespace: 'auth.signup',
    namespaces: ['auth.signup'],
  },
  {
    pattern: '/verify',
    defaultNamespace: 'auth.verify',
    namespaces: ['auth.verify'],
  },
  {
    pattern: '/waitlist',
    defaultNamespace: 'auth.waitlist',
    namespaces: ['auth.waitlist'],
  },
  {
    pattern: '/reset-password',
    defaultNamespace: 'auth.resetPassword',
    namespaces: ['auth.resetPassword'],
  },
  {
    pattern: '/sso',
    defaultNamespace: 'auth.sso',
    namespaces: ['auth.sso'],
  },
  {
    pattern: '/error/[[...callback]]',
    defaultNamespace: 'auth.error',
    namespaces: ['auth.common', 'auth.error', 'auth.sso'],
  },
  {
    pattern: '/mcp/authorize',
    defaultNamespace: 'auth.mcp',
    namespaces: ['auth.mcp'],
  },
  {
    pattern: '/[...notFound]',
    defaultNamespace: 'notFound',
    namespaces: ['notFound'],
  },
]

export function normalizeRoutePath(pathname: string) {
  const normalized = pathname.trim()

  if (!normalized.startsWith('/')) {
    throw new Error(`Expected a canonical route pathname, received "${pathname}"`)
  }

  if (normalized === '/') {
    return '/'
  }

  return normalized.replace(/\/+$/, '')
}

function splitPathSegments(pathname: string) {
  return normalizeRoutePath(pathname).split('/').filter(Boolean)
}

type RouteSegmentKind = 'static' | 'dynamic' | 'catch-all' | 'optional-catch-all'

type RoutePatternMatch = {
  depth: number
  specificity: number[]
}

const ROUTE_SEGMENT_SPECIFICITY: Record<RouteSegmentKind, number> = {
  static: 3,
  dynamic: 2,
  'catch-all': 1,
  'optional-catch-all': 0,
}

function getRouteSegmentKind(segment: string): RouteSegmentKind {
  if (/^\[\[\.\.\.[^[\]/]+\]\]$/.test(segment)) {
    return 'optional-catch-all'
  }

  if (/^\[\.\.\.[^[\]/]+\]$/.test(segment)) {
    return 'catch-all'
  }

  if (/^\[[^[\]/]+\]$/.test(segment)) {
    return 'dynamic'
  }

  return 'static'
}

function isDynamicSegment(segment: string) {
  return getRouteSegmentKind(segment) !== 'static'
}

function matchRoutePattern(pattern: string, pathname: string): RoutePatternMatch | null {
  const routeSegments = splitPathSegments(pathname)
  const patternSegments = splitPathSegments(pattern)
  const specificity: number[] = []
  let routeIndex = 0

  for (const segment of patternSegments) {
    const segmentKind = getRouteSegmentKind(segment)
    specificity.push(ROUTE_SEGMENT_SPECIFICITY[segmentKind])

    if (segmentKind === 'static') {
      if (routeSegments[routeIndex] !== segment) {
        return null
      }
      routeIndex += 1
      continue
    }

    if (segmentKind === 'dynamic') {
      if (!routeSegments[routeIndex]) {
        return null
      }
      routeIndex += 1
      continue
    }

    if (segmentKind === 'catch-all') {
      if (routeIndex >= routeSegments.length) {
        return null
      }
      routeIndex = routeSegments.length
      continue
    }

    routeIndex = routeSegments.length
  }

  if (routeIndex !== routeSegments.length) {
    return null
  }

  return {
    depth: patternSegments.length,
    specificity,
  }
}

function compareRoutePatternMatches(left: RoutePatternMatch, right: RoutePatternMatch) {
  const maxSpecificityLength = Math.min(left.specificity.length, right.specificity.length)
  for (let index = 0; index < maxSpecificityLength; index += 1) {
    const difference = left.specificity[index]! - right.specificity[index]!
    if (difference !== 0) {
      return difference
    }
  }

  if (left.depth !== right.depth) {
    return left.depth - right.depth
  }

  return 0
}

function findBestMatchingRoute<T>(
  pathname: string,
  candidates: Iterable<T>,
  getPattern: (candidate: T) => string
): T | null {
  const normalizedPathname = normalizeRoutePath(pathname)
  let bestMatch: { candidate: T; routeMatch: RoutePatternMatch } | null = null

  for (const candidate of candidates) {
    const pattern = normalizeRoutePath(getPattern(candidate))

    if (pattern === normalizedPathname) {
      return candidate
    }

    const routeMatch = matchRoutePattern(pattern, normalizedPathname)
    if (!routeMatch) {
      continue
    }

    if (!bestMatch || compareRoutePatternMatches(routeMatch, bestMatch.routeMatch) > 0) {
      bestMatch = {
        candidate,
        routeMatch,
      }
    }
  }

  return bestMatch?.candidate ?? null
}

export function findBestMatchingRoutePattern(pathname: string, routePatterns: Iterable<string>) {
  return findBestMatchingRoute(pathname, routePatterns, (routePattern) => routePattern)
}

function toKeySegment(value: string) {
  return value
    .replace(/\[\[\.\.\.[^[\]/]+\]\]|\[\.\.\.[^[\]/]+\]|\[[^[\]/]+\]/g, '')
    .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, next: string) => next.toUpperCase())
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
}

function getLastStaticRouteSegment(pathname: string) {
  const segments = splitPathSegments(pathname)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (!segment || isDynamicSegment(segment)) {
      continue
    }
    return toKeySegment(segment)
  }

  return 'route'
}

export function getRouteOwnership(pathname: string): RouteOwnershipRule | null {
  return findBestMatchingRoute(pathname, EXPLICIT_ROUTE_OWNERSHIP_RULES, (rule) => rule.pattern)
}

export function getRouteOwnedNamespaces(pathname: string) {
  const ownership = getRouteOwnership(pathname)
  if (ownership) {
    return ownership.namespaces
  }

  const fallbackNamespace = deriveFallbackNamespace(pathname)
  return [fallbackNamespace]
}

export function deriveFallbackNamespace(pathname: string, options?: { metadata?: boolean }) {
  const segment = getLastStaticRouteSegment(pathname)
  if (options?.metadata) {
    return `meta.${segment}`
  }

  const normalizedPathname = normalizeRoutePath(pathname)
  if (normalizedPathname.startsWith('/workspace/')) {
    return `workspace.${segment}`
  }

  if (normalizedPathname.startsWith('/admin/')) {
    return `admin.${segment}`
  }

  return segment
}

export function deriveRouteNamespace(pathname: string, options?: { metadata?: boolean }) {
  const ownership = getRouteOwnership(pathname)
  if (!ownership) {
    return deriveFallbackNamespace(pathname, options)
  }

  if (options?.metadata) {
    return ownership.metadataNamespace ?? deriveFallbackNamespace(pathname, { metadata: true })
  }

  return ownership.defaultNamespace
}

export function deriveComponentKeySegment(filePath: string, projectRoot: string) {
  const relativePath = path.relative(projectRoot, filePath)
  const withoutExtension = relativePath.replace(/\.[^.]+$/, '')
  const baseName = path.basename(withoutExtension)
  const candidate =
    baseName === 'page' || baseName === 'layout' || baseName === 'index'
      ? path.basename(path.dirname(withoutExtension))
      : baseName

  const normalized = toKeySegment(candidate)
  const lowerCamelNormalized = normalized
    ? `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`
    : ''
  return lowerCamelNormalized || 'copy'
}
