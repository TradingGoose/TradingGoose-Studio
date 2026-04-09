import type { RegistrationMode, WaitlistStatus } from '@/lib/registration/shared'

export interface AdminWaitlistEntry {
  id: string
  email: string
  status: WaitlistStatus
  approvedAt: string | null
  approvedByUserId: string | null
  rejectedAt: string | null
  rejectedByUserId: string | null
  signedUpAt: string | null
  userId: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminRegistrationSnapshot {
  registrationMode: RegistrationMode
  waitlist: AdminWaitlistEntry[]
}
