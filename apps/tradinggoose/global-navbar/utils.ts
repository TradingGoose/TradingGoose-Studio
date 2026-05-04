import {
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
import { getPublicCopy } from '@/i18n/public-copy'
import { stripLocaleFromPathname, type LocaleCode } from '@/i18n/utils'
import type { NavItemLink, NavSection } from './types'

export function getWorkspaceIdFromPath(path: string) {
  const { pathname } = stripLocaleFromPathname(path)
  const match = /^\/workspace\/([^/]+)/.exec(pathname)
  return match?.[1]
}

export function getWorkspaceSwitchPath(
  path: string,
  targetWorkspaceId: string,
  searchParams?: string
) {
  const { pathname } = stripLocaleFromPathname(path)
  const match = /^\/workspace\/[^/]+(?:\/([^/]+))?/.exec(pathname)
  const section = match?.[1] ?? null

  // Only allow safe top-level sections to carry over between workspaces.
  // Workflow routes (/w) and deep paths are reset to the dashboard to avoid stale data.
  const allowedSections = new Set([
    'dashboard',
    'knowledge',
    'files',
    'logs',
    'environment',
    'api-keys',
    'integrations',
  ])
  const sectionPath = section && allowedSections.has(section) ? `/${section}` : '/dashboard'

  const basePath = `/workspace/${targetWorkspaceId}${sectionPath}`

  const normalizedSearch = searchParams?.replace(/^\?/, '')
  return normalizedSearch ? `${basePath}?${normalizedSearch}` : basePath
}

export function createWorkspaceNav(locale: LocaleCode, workspaceId?: string): NavItemLink[] {
  const copy = getPublicCopy(locale).workspace.nav

  if (!workspaceId) {
    return [
      { title: copy.workspace.dashboard, url: '/dashboard', icon: LayoutTemplate, section: 'workspace' },
      { title: copy.workspace.knowledge, url: '/knowledge', icon: LibraryBig, section: 'workspace' },
      { title: copy.workspace.files, url: '/files', icon: Files, section: 'workspace' },
      { title: copy.workspace.logs, url: '/logs', icon: Scroll, section: 'workspace' },
    ]
  }

  const base = `/workspace/${workspaceId}`
  return [
    { title: copy.workspace.dashboard, url: `${base}/dashboard`, icon: LayoutTemplate, section: 'workspace' },
    { title: copy.workspace.knowledge, url: `${base}/knowledge`, icon: LibraryBig, section: 'workspace' },
    { title: copy.workspace.files, url: `${base}/files`, icon: Files, section: 'workspace' },
    { title: copy.workspace.logs, url: `${base}/logs`, icon: Scroll, section: 'workspace' },
    { title: copy.more.environment, url: `${base}/environment`, icon: Braces, section: 'more' },
    { title: copy.more.apiKeys, url: `${base}/api-keys`, icon: KeyRound, section: 'more' },
    { title: copy.more.integrations, url: `${base}/integrations`, icon: Waypoints, section: 'more' },
  ]
}

export function createAdminNav(locale: LocaleCode): NavItemLink[] {
  const copy = getPublicCopy(locale).workspace.nav

  return [
    { title: copy.admin.overview, url: '/admin', icon: ShieldCheck, section: 'admin', match: 'exact' },
    { title: copy.admin.billing, url: '/admin/billing', icon: Receipt, section: 'admin' },
    { title: copy.admin.services, url: '/admin/services', icon: KeyRound, section: 'admin' },
    { title: copy.admin.integrations, url: '/admin/integrations', icon: Waypoints, section: 'admin' },
    { title: copy.admin.registration, url: '/admin/registration', icon: UserRoundPlus, section: 'admin' },
  ]
}

export function createNavSections(pathname: string, workspaceItems: NavItemLink[]): NavSection[] {
  const { pathname: normalizedPathname } = stripLocaleFromPathname(pathname)
  return workspaceItems.map((item) => ({
    ...item,
    isActive: isPathActive(normalizedPathname, item.url, item.match),
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
