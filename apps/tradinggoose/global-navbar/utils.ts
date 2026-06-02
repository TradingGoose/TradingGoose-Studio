import {
  Activity,
  Braces,
  Files,
  KeyRound,
  LayoutTemplate,
  LibraryBig,
  Receipt,
  ScrollText,
  ShieldCheck,
  UserRoundPlus,
  Waypoints,
} from 'lucide-react'
import type { NavItemLink, NavSection } from './types'

type WorkspaceNavLabels = {
  workspace: {
    dashboard: string
    knowledge: string
    files: string
    records: string
    monitor: string
  }
  more: {
    environment: string
    apiKeys: string
    integrations: string
  }
}

type AdminNavLabels = {
  overview: string
  billing: string
  services: string
  integrations: string
  registration: string
}

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
    'records',
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

export function createWorkspaceNav(
  copy: WorkspaceNavLabels,
  workspaceId?: string
): NavItemLink[] {
  if (!workspaceId) {
    return [
      { title: copy.workspace.dashboard, url: '/dashboard', icon: LayoutTemplate, section: 'workspace' },
      { title: copy.workspace.knowledge, url: '/knowledge', icon: LibraryBig, section: 'workspace' },
      { title: copy.workspace.files, url: '/files', icon: Files, section: 'workspace' },
      { title: copy.workspace.monitor, url: '/monitor', icon: Activity, section: 'workspace' },
    ]
  }

  const base = `/workspace/${workspaceId}`
  return [
    { title: copy.workspace.dashboard, url: `${base}/dashboard`, icon: LayoutTemplate, section: 'workspace' },
    { title: copy.workspace.knowledge, url: `${base}/knowledge`, icon: LibraryBig, section: 'workspace' },
    { title: copy.workspace.files, url: `${base}/files`, icon: Files, section: 'workspace' },
    { title: copy.workspace.records, url: `${base}/records`, icon: ScrollText, section: 'workspace' },
    { title: copy.workspace.monitor, url: `${base}/monitor`, icon: Activity, section: 'workspace' },
    { title: copy.more.environment, url: `${base}/environment`, icon: Braces, section: 'more' },
    { title: copy.more.apiKeys, url: `${base}/api-keys`, icon: KeyRound, section: 'more' },
    { title: copy.more.integrations, url: `${base}/integrations`, icon: Waypoints, section: 'more' },
  ]
}

export function createAdminNav(
  copy: AdminNavLabels
): NavItemLink[] {
  return [
    { title: copy.overview, url: '/admin', icon: ShieldCheck, section: 'admin', match: 'exact' },
    { title: copy.billing, url: '/admin/billing', icon: Receipt, section: 'admin' },
    { title: copy.services, url: '/admin/services', icon: KeyRound, section: 'admin' },
    { title: copy.integrations, url: '/admin/integrations', icon: Waypoints, section: 'admin' },
    { title: copy.registration, url: '/admin/registration', icon: UserRoundPlus, section: 'admin' },
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
