import { Files, Frame, KeyRound, LibraryBig, Map as MapIcon, Server } from 'lucide-react'
import type { NavItemLink, NavSection } from './types'

export function getWorkspaceIdFromPath(path: string) {
  const match = /^\/workspace\/([^/]+)/.exec(path)
  return match?.[1]
}

export function createWorkspaceNav(workspaceId?: string): NavItemLink[] {
  if (!workspaceId) {
    return [
      { title: 'Dashboard', url: '/dashboard', icon: Frame },
      { title: 'Knowledge', url: '/knowledge', icon: LibraryBig },
      { title: 'Files', url: '/files', icon: Files },
      { title: 'Logs', url: '/logs', icon: MapIcon },
    ]
  }

  const base = `/workspace/${workspaceId}`
  return [
    { title: 'Dashboard', url: `${base}/dashboard`, icon: Frame },
    { title: 'Knowledge', url: `${base}/knowledge`, icon: LibraryBig },
    { title: 'Files', url: `${base}/files`, icon: Files },
    { title: 'API Keys', url: `${base}/api-keys`, icon: KeyRound },
    { title: 'Logs', url: `${base}/logs`, icon: MapIcon },
    { title: 'MCP Servers', url: `${base}/mcp`, icon: Server },
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
