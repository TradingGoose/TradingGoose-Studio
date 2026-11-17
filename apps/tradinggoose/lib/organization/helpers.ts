/**
 * Helper functions for organization-related computations
 * These are pure functions that compute values from organization data
 */

import type { Organization } from '@/lib/organization/types'

/**
 * Get the role of a user in an organization
 */
export function getUserRole(
  organization: Organization | null | undefined,
  userEmail?: string
): string {
  if (!userEmail || !organization?.members) {
    return 'member'
  }
  const currentMember = organization.members.find((m) => m.user?.email === userEmail)
  return currentMember?.role ?? 'member'
}
