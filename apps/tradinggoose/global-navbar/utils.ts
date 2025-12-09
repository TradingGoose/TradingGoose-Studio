import { Braces, Files, Frame, KeyRound, LibraryBig, Map as MapIcon, Server, Waypoints, Wrench } from 'lucide-react'
import type { NavItemLink, NavSection } from './types'

export function getWorkspaceIdFromPath(path: string) {
  const match = /^\/workspace\/([^/]+)/.exec(path)
  return match?.[1]
}

export function getWorkspaceSwitchPath(path: string, targetWorkspaceId: string, searchParams?: string) {
  const match = /^\/workspace\/[^/]+(?:\/([^/]+))?/.exec(path)
  const section = match?.[1] ?? null

  // Only allow safe top-level sections to carry over between workspaces.
  // Workflow routes (/w) and deep paths are reset to the dashboard to avoid stale data.
  const allowedSections = new Set(['dashboard', 'knowledge', 'custom-tools', 'files', 'logs', 'environment', 'api-keys', 'mcp', 'integrations'])
  const sectionPath = section && allowedSections.has(section) ? `/${section}` : '/dashboard'

  const basePath = `/workspace/${targetWorkspaceId}${sectionPath}`

  const normalizedSearch = searchParams?.replace(/^\?/, '')
  return normalizedSearch ? `${basePath}?${normalizedSearch}` : basePath
}

export function createWorkspaceNav(workspaceId?: string): NavItemLink[] {
  if (!workspaceId) {
    return [
      { title: 'Dashboard', url: '/dashboard', icon: Frame, section: 'workspace' },
      { title: 'Knowledge', url: '/knowledge', icon: LibraryBig, section: 'workspace' },
      { title: 'Files', url: '/files', icon: Files, section: 'workspace' },
      { title: 'Logs', url: '/logs', icon: MapIcon, section: 'workspace' },
    ]
  }

  const base = `/workspace/${workspaceId}`
  return [
    { title: 'Dashboard', url: `${base}/dashboard`, icon: Frame, section: 'workspace' },
    { title: 'Knowledge', url: `${base}/knowledge`, icon: LibraryBig, section: 'workspace' },
    { title: 'Custom Tools', url: `${base}/custom-tools`, icon: Wrench, section: 'workspace' },
    { title: 'MCP Servers', url: `${base}/mcp`, icon: Server, section: 'workspace' },
    { title: 'Files', url: `${base}/files`, icon: Files, section: 'workspace' },
    { title: 'Logs', url: `${base}/logs`, icon: MapIcon, section: 'workspace' },
    { title: 'Environment Variable', url: `${base}/environment`, icon: Braces, section: 'more' },
    { title: 'API Keys', url: `${base}/api-keys`, icon: KeyRound, section: 'more' },
    { title: 'Integrations', url: `${base}/integrations`, icon: Waypoints, section: 'more' },
  ]
}

export function createNavSections(pathname: string, workspaceItems: NavItemLink[]): NavSection[] {
  return workspaceItems.map((item) => ({
    ...item,
    isActive: isPathActive(pathname, item.url),
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

function isPathActive(pathname: string, url: string) {
  if (!url.startsWith('/')) {
    return false
  }

  if (url === '/') {
    return pathname === '/'
  }

  return pathname === url || pathname.startsWith(`${url}/`)
}
