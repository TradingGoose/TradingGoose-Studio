import { requireSystemAdminUserId } from '@/lib/admin/access'

export async function requireAdminBillingUserId(): Promise<string> {
  return requireSystemAdminUserId({ claimBootstrap: true })
}
