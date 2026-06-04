import type { LucideIcon } from 'lucide-react'

export interface NavItemLink {
  key: string
  title: string
  url: string
  icon: LucideIcon
  section?: 'workspace' | 'admin' | 'more'
}

export interface NavSection extends NavItemLink {
  isActive?: boolean
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  billingOwner?: { type: 'user'; userId: string } | { type: 'organization'; organizationId: string }
  role?: string
  membershipId?: string
  permissions?: 'admin' | 'write' | 'read' | null
}
