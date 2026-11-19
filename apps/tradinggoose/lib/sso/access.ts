import { APIError, type DBAdapter } from 'better-auth'
import { getHostname } from 'tldts'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { splitSsoDomains } from '@/lib/sso/consts'

// Match the hostname normalization used by Better Auth's DNS verification and domain matching.
export function getSsoProviderHostnames(domain: string) {
  const hostnames = new Set<string>()
  for (const entry of splitSsoDomains(domain)) {
    const hostname = getHostname(entry)
    if (!hostname) return []
    hostnames.add(hostname.toLowerCase())
  }
  return [...hostnames]
}

// Preserve Better Auth's exact-domain preference and page through verified multi-domain claims.
export async function findVerifiedSsoProviderId(adapter: DBAdapter, domain: string) {
  const search = domain.trim().toLowerCase()
  const verified = { field: 'domainVerified', value: true }
  const matches = await adapter.findMany<{ providerId: string }>({
    model: 'ssoProvider',
    where: [verified, { field: 'domain', value: search }],
    select: ['providerId'],
    limit: 2,
  })
  if (!matches.length) {
    const limit = 100
    for (let offset = 0; matches.length < 2; offset += limit) {
      const providers = await adapter.findMany<{ providerId: string; domain: string }>({
        model: 'ssoProvider',
        where: [verified],
        select: ['providerId', 'domain'],
        sortBy: { field: 'providerId', direction: 'asc' },
        limit,
        offset,
      })
      matches.push(
        ...providers.filter((provider) =>
          getSsoProviderHostnames(provider.domain).some(
            (hostname) => search === hostname || search.endsWith(`.${hostname}`)
          )
        )
      )
      if (providers.length < limit) break
    }
  }
  if (matches.length > 1) {
    throw new APIError('CONFLICT', {
      code: 'SSO_PROVIDER_ID_REQUIRED',
      message: 'Multiple verified SSO providers match. Enter your organization’s provider ID.',
    })
  }
  return matches[0]?.providerId
}

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
