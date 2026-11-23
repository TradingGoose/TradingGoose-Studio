import { APIError } from 'better-auth/api'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { isSystemIntegrationManagedOAuthServiceProviderId } from '@/lib/oauth/oauth'
import { getOrganizationAccessState } from '@/lib/organization/access'

export function assertSsoProviderIdAllowed(providerId: unknown) {
  if (
    typeof providerId === 'string' &&
    isSystemIntegrationManagedOAuthServiceProviderId(providerId)
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: 'This providerId is reserved and cannot be used for an SSO provider',
    })
  }
}

export async function requireSsoOrganization(
  session: {
    user: { id: string }
    session: { id: string; activeOrganizationId?: string | null }
  } | null
) {
  if (!session?.user?.id) throw new APIError('UNAUTHORIZED', { message: 'Authentication required' })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    throw new APIError('BAD_REQUEST', { message: 'Active organization is required' })
  const [{ billingEnabled }, isOrganizationAdmin, billing] = await Promise.all([
    getBillingGateState(),
    isOrganizationOwnerOrAdmin(session.user.id, organizationId),
    getOrganizationBillingData(organizationId),
  ])
  const access = getOrganizationAccessState({
    billingEnabled,
    hasOrganization: true,
    isOrganizationAdmin,
    organizationTier: billing?.subscriptionTier,
  })
  if (!access.canManageOrganization) {
    throw new APIError('FORBIDDEN', {
      message: 'Only organization owners and admins can manage SSO',
    })
  }
  if (!access.canConfigureSso) {
    throw new APIError('FORBIDDEN', {
      message: 'Single Sign-On is not enabled for this organization',
    })
  }
  return organizationId
}
