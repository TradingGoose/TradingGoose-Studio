import type { DecimalAmount } from '@tradinggoose/billing/money'
import type { BillingTierSummary } from '@/lib/billing/types'

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
  billingEnabled?: boolean
  status: string
  seats?: number
  referenceType?: 'user' | 'organization'
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
  metadata?: any
  tier?: BillingTierSummary | null
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
  currentUsage: DecimalAmount | null
  usageLimit: DecimalAmount | null
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: string
  lastActive: string | null
}

export interface OrganizationBillingData {
  organizationId: string
  organizationName: string
  billingEnabled?: boolean
  subscriptionTier: BillingTierSummary | null
  subscriptionStatus: string
  seatPriceUsd: DecimalAmount | null
  seatCount: number | null
  seatMaximum: number | null
  seatMode: 'fixed' | 'adjustable'
  totalSeats: number
  usedSeats: number
  seatsCount: number
  totalCurrentUsage: DecimalAmount
  totalUsageLimit: DecimalAmount | null
  warningThresholdPercent: number
  isWarning: boolean
  isExceeded: boolean
  minimumUsageLimit: DecimalAmount
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  members?: MemberUsageData[]
  userRole?: string
  billingBlocked?: boolean
}
