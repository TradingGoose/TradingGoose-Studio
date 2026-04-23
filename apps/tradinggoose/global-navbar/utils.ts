import {
  Activity,
  Braces,
  Files,
  KeyRound,
  LayoutTemplate,
  LibraryBig,
  Receipt,
  Scroll,
  ShieldCheck,
  UserRoundPlus,
  Waypoints,
} from 'lucide-react'
import type { NavItemLink, NavSection } from './types'

export function getWorkspaceIdFromPath(path: string) {
  const match = /^\/workspace\/([^/]+)/.exec(path)
  return match?.[1]
}

export function getWorkspaceSwitchPath(
  path: string,
  targetWorkspaceId: string,
  searchParams?: string
) {
  const match = /^\/workspace\/[^/]+(?:\/([^/]+))?/.exec(path)
  const section = match?.[1] ?? null

  // Only allow safe top-level sections to carry over between workspaces.
  // Workflow routes (/w) and deep paths are reset to the dashboard to avoid stale data.
  const allowedSections = new Set([
    'dashboard',
    'knowledge',
    'files',
    'logs',
    'monitor',
    'environment',
    'api-keys',
    'integrations',
  ])
  const sectionPath = section && allowedSections.has(section) ? `/${section}` : '/dashboard'

  const basePath = `/workspace/${targetWorkspaceId}${sectionPath}`

  const normalizedSearch = searchParams?.replace(/^\?/, '')
  return normalizedSearch ? `${basePath}?${normalizedSearch}` : basePath
}

export function createWorkspaceNav(workspaceId?: string): NavItemLink[] {
  if (!workspaceId) {
    return [
      { title: 'Dashboard', url: '/dashboard', icon: LayoutTemplate, section: 'workspace' },
      { title: 'Knowledge', url: '/knowledge', icon: LibraryBig, section: 'workspace' },
      { title: 'Files', url: '/files', icon: Files, section: 'workspace' },
      { title: 'Logs', url: '/logs', icon: Scroll, section: 'workspace' },
      { title: 'Monitor', url: '/monitor', icon: Activity, section: 'workspace' },
    ]
  }

  const base = `/workspace/${workspaceId}`
  return [
    { title: 'Dashboard', url: `${base}/dashboard`, icon: LayoutTemplate, section: 'workspace' },
    { title: 'Knowledge', url: `${base}/knowledge`, icon: LibraryBig, section: 'workspace' },
    { title: 'Files', url: `${base}/files`, icon: Files, section: 'workspace' },
    { title: 'Logs', url: `${base}/logs`, icon: Scroll, section: 'workspace' },
    { title: 'Monitor', url: `${base}/monitor`, icon: Activity, section: 'workspace' },
    { title: 'Environment Variable', url: `${base}/environment`, icon: Braces, section: 'more' },
    { title: 'API Keys', url: `${base}/api-keys`, icon: KeyRound, section: 'more' },
    { title: 'Integrations', url: `${base}/integrations`, icon: Waypoints, section: 'more' },
  ]
}

export function createAdminNav(): NavItemLink[] {
  return [
    { title: 'Overview', url: '/admin', icon: ShieldCheck, section: 'admin', match: 'exact' },
    { title: 'Billing', url: '/admin/billing', icon: Receipt, section: 'admin' },
    { title: 'Services', url: '/admin/services', icon: KeyRound, section: 'admin' },
    { title: 'Integrations', url: '/admin/integrations', icon: Waypoints, section: 'admin' },
    { title: 'Registration', url: '/admin/registration', icon: UserRoundPlus, section: 'admin' },
  ]
}

export function createNavSections(pathname: string, workspaceItems: NavItemLink[]): NavSection[] {
  return workspaceItems.map((item) => ({
    ...item,
    isActive: isPathActive(pathname, item.url, item.match),
  }))
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function isPathActive(pathname: string, url: string, match: 'exact' | 'prefix' = 'prefix') {
  if (!url.startsWith('/')) {
    return false
  }

  if (url === '/' || match === 'exact') {
    return pathname === url
  }

  return pathname === url || pathname.startsWith(`${url}/`)
}
