export interface User {
  name?: string
  email?: string
  id?: string
  image?: string | null
}

export interface Member {
  id: string
  role: string
  user?: User
}

export interface Invitation {
  id: string
  email: string
  status: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  logo?: string | null
  members?: Member[]
  invitations?: Invitation[]
  createdAt: string | Date
  [key: string]: unknown
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  billingOwner?: { type: 'user'; userId: string } | { type: 'organization'; organizationId: string }
  isOwner: boolean
  canInvite: boolean
}
