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

const WORKSPACE_NAV_KEYS = [
  'dashboard',
  'knowledge',
  'files',
  'records',
  'monitor',
  'environment',
  'api-keys',
  'integrations',
] as const
const ADMIN_NAV_KEYS = ['overview', 'billing', 'services', 'integrations', 'registration'] as const

export type WorkspaceNavKey = (typeof WORKSPACE_NAV_KEYS)[number]
type AdminNavKey = (typeof ADMIN_NAV_KEYS)[number]

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

function isWorkspaceNavKey(value: string | undefined): value is WorkspaceNavKey {
  return WORKSPACE_NAV_KEYS.includes(value as WorkspaceNavKey)
}

function isAdminNavKey(value: string | undefined): value is AdminNavKey {
  return ADMIN_NAV_KEYS.includes(value as AdminNavKey)
}

export function getWorkspaceNavState(segments: string[]) {
  const [workspaceId, section] = segments

  return {
    workspaceId,
    activeKey: isWorkspaceNavKey(section) ? section : 'dashboard',
  }
}

export function getAdminNavState(segments: string[]) {
  const [section] = segments

  return {
    activeKey: isAdminNavKey(section) ? section : 'overview',
  }
}

export function getWorkspaceSwitchPath(
  targetWorkspaceId: string,
  section?: WorkspaceNavKey | null,
  searchParams?: string
) {
  const sectionPath = section ? `/${section}` : '/dashboard'
  const basePath = `/workspace/${targetWorkspaceId}${sectionPath}`

  const normalizedSearch = searchParams?.replace(/^\?/, '')
  return normalizedSearch ? `${basePath}?${normalizedSearch}` : basePath
}

export function createWorkspaceNav(copy: WorkspaceNavLabels, workspaceId?: string): NavItemLink[] {
  if (!workspaceId) {
    return []
  }

  const base = `/workspace/${workspaceId}`
  const items = [
    ['dashboard', copy.workspace.dashboard, LayoutTemplate, 'workspace'],
    ['knowledge', copy.workspace.knowledge, LibraryBig, 'workspace'],
    ['files', copy.workspace.files, Files, 'workspace'],
    ['records', copy.workspace.records, ScrollText, 'workspace'],
    ['monitor', copy.workspace.monitor, Activity, 'workspace'],
    ['environment', copy.more.environment, Braces, 'more'],
    ['api-keys', copy.more.apiKeys, KeyRound, 'more'],
    ['integrations', copy.more.integrations, Waypoints, 'more'],
  ] as const

  return items.map(([key, title, icon, section]) => ({
    key,
    title,
    url: `${base}/${key}`,
    icon,
    section,
  }))
}

export function createAdminNav(copy: AdminNavLabels): NavItemLink[] {
  const items = [
    ['overview', copy.overview, '/admin', ShieldCheck],
    ['billing', copy.billing, '/admin/billing', Receipt],
    ['services', copy.services, '/admin/services', KeyRound],
    ['integrations', copy.integrations, '/admin/integrations', Waypoints],
    ['registration', copy.registration, '/admin/registration', UserRoundPlus],
  ] as const

  return items.map(([key, title, url, icon]) => ({ key, title, url, icon, section: 'admin' }))
}

export function createNavSections(workspaceItems: NavItemLink[], activeKey: string): NavSection[] {
  return workspaceItems.map((item) => ({
    ...item,
    isActive: item.key === activeKey,
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
