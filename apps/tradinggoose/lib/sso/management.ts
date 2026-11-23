import { db } from '@tradinggoose/db'
import { APIError } from 'better-auth/api'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { isOrganizationSsoEnabled } from '@/lib/organization/access'
import { normalizeSsoDomains } from '@/lib/sso/domains'

export function requireSsoRegistrationDomains(value: unknown) {
  const domain = normalizeSsoDomains(value)
  if (!domain) throw new APIError('BAD_REQUEST', { message: 'Enter a valid domain.' })
  return domain
}

export async function requireOrganizationSsoEnabled(
  organizationId: string,
  store: Pick<typeof db, 'select'> = db
) {
  const gate = await getBillingGateState(store)
  if (!gate.billingEnabled) return gate
  const subscription = await getOrganizationSubscription(organizationId, store)
  if (!isOrganizationSsoEnabled(gate.billingEnabled, subscription?.tier)) {
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
