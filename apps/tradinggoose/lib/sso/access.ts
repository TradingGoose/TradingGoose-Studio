import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { getOrganizationAccessState } from '@/lib/organization/access'

export async function getSsoOrganizationAccess(userId: string, organizationId: string) {
  const [{ billingEnabled }, isOrganizationAdmin, billing] = await Promise.all([
    getBillingGateState(),
    isOrganizationOwnerOrAdmin(userId, organizationId),
    getOrganizationBillingData(organizationId),
  ])
  return getOrganizationAccessState({
    billingEnabled,
    hasOrganization: true,
    isOrganizationAdmin,
    organizationTier: billing?.subscriptionTier,
  })
}
