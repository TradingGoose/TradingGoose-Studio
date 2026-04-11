import { getSystemAdminAccess } from '@/lib/admin/access'

export async function requireAdminBillingUserId(): Promise<string> {
  const access = await getSystemAdminAccess()

  if (!access.isAuthenticated || !access.userId) {
    throw new Error('UNAUTHORIZED')
  }

  if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
    throw new Error('FORBIDDEN')
  }

  return access.userId
}
