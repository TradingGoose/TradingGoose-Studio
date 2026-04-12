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

export interface Subscription {
  id: string
  status: string
  seats?: number
  referenceType?: 'user' | 'organization'
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
  metadata?: any
  [key: string]: unknown
}

export interface WorkspaceInvitation {
  workspaceId: string
  permission: string
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  billingOwner?: { type: 'user'; userId: string } | { type: 'organization'; organizationId: string }
  isOwner: boolean
  canInvite: boolean
}

export interface OrganizationFormData {
  name: string
  slug: string
  logo: string
}

export interface MemberUsageData {
  userId: string
  userName: string
  userEmail: string
  currentUsage: number
  usageLimit: number
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: string
  lastActive: string | null
}

export interface OrganizationBillingData {
  organizationId: string
  organizationName: string
  subscriptionTierName: string
  subscriptionStatus: string
  totalSeats: number
  usedSeats: number
  seatsCount: number
  totalCurrentUsage: number
  totalUsageLimit: number
  minimumUsageLimit: number
  averageUsagePerMember: number
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  members?: MemberUsageData[]
  userRole?: string
  billingBlocked?: boolean
}

export interface OrganizationState {
  // Core organization data
  organizations: Organization[]
  activeOrganization: Organization | null

  // Team management
  subscriptionData: Subscription | null
  userWorkspaces: Workspace[]

  // Organization billing and usage
  organizationBillingData: OrganizationBillingData | null

  // Organization settings
  orgFormData: OrganizationFormData

  // Loading states
  isLoading: boolean
  isLoadingSubscription: boolean
  isLoadingOrgBilling: boolean
  isCreatingOrg: boolean
  isInviting: boolean
  isSavingOrgSettings: boolean

  // Error states
  error: string | null
  orgSettingsError: string | null

  // Success states
  inviteSuccess: boolean
  orgSettingsSuccess: string | null

  // Cache timestamps
  lastFetched: number | null
  lastSubscriptionFetched: number | null
  lastOrgBillingFetched: number | null
}

export interface OrganizationStore extends OrganizationState {
  loadData: () => Promise<void>
  loadOrganizationSubscription: (orgId: string) => Promise<void>
  loadOrganizationBillingData: (organizationId: string, force?: boolean) => Promise<void>
  loadUserWorkspaces: (userId?: string) => Promise<void>
  refreshOrganization: () => Promise<void>

  // Organization management
  createOrganization: (name: string, slug: string) => Promise<void>
  setActiveOrganization: (orgId: string) => Promise<void>
  updateOrganizationSettings: () => Promise<void>

  // Team management
  inviteMember: (email: string, workspaceInvitations?: WorkspaceInvitation[]) => Promise<void>
  removeMember: (memberId: string, shouldReduceSeats?: boolean) => Promise<void>
  cancelInvitation: (invitationId: string) => Promise<void>

  // Seat management
  addSeats: (newSeatCount: number) => Promise<void>
  reduceSeats: (newSeatCount: number) => Promise<void>

  getUserRole: (userEmail?: string) => string
  isAdminOrOwner: (userEmail?: string) => boolean
  getUsedSeats: () => { used: number; members: number; pending: number }

  setOrgFormData: (data: Partial<OrganizationFormData>) => void

  clearError: () => void
  clearSuccessMessages: () => void
}
