import type { LucideIcon } from 'lucide-react'

export interface NavItemLink {
  title: string
  url: string
  icon: LucideIcon
  section?: 'workspace' | 'more'
}

export interface NavSection extends NavItemLink {
  isActive?: boolean
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
  membershipId?: string
  permissions?: 'admin' | 'write' | 'read' | null
}
