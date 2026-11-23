import { APIError } from 'better-auth/api'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { isSystemIntegrationManagedOAuthServiceProviderId } from '@/lib/oauth/oauth'
import { isOrganizationSsoEnabled } from '@/lib/organization/access'

export function assertSsoProviderIdAllowed(providerId: unknown) {
  if (typeof providerId !== 'string') return
  if (isSystemIntegrationManagedOAuthServiceProviderId(providerId)) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: 'This providerId is reserved and cannot be used for an SSO provider',
    })
  }
  // The 63-character DNS label also contains the "_better-auth-token-" prefix.
  if (providerId.length > 44) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: 'SSO provider IDs must be 44 characters or fewer',
    })
  }
}

export async function requireOrganizationSsoEnabled(organizationId: string) {
  const [gate, billing] = await Promise.all([
    getBillingGateState(),
    getOrganizationBillingData(organizationId),
  ])
  if (!isOrganizationSsoEnabled(gate.billingEnabled, billing?.subscriptionTier)) {
    throw new APIError('FORBIDDEN', {
      message: 'Single Sign-On is not enabled for this organization',
    })
  }
  return gate
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
  if (!(await isOrganizationOwnerOrAdmin(session.user.id, organizationId))) {
    throw new APIError('FORBIDDEN', {
      message: 'Only organization owners and admins can manage SSO',
    })
  }
  await requireOrganizationSsoEnabled(organizationId)
  return organizationId
}
