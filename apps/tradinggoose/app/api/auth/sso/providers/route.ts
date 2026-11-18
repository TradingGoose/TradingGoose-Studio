import { db, ssoProvider } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getHostname } from 'tldts'
import { getSession } from '@/lib/auth'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'

const logger = createLogger('SSO-Providers')

type OrganizationSession = {
  activeOrganizationId?: string | null
}

function getDnsRecordNames(providerId: string, domain: string) {
  // Use the same hostname parser as Better Auth's domain verifier.
  const hostnames = new Set<string>()
  for (const entry of domain.split(',')) {
    const value = entry.trim()
    if (!value) continue
    const hostname = getHostname(value)
    if (!hostname) return []
    hostnames.add(hostname.toLowerCase())
  }
  return Array.from(hostnames, (hostname) => `_better-auth-token-${providerId}.${hostname}`)
}

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const activeOrganizationId = (session.session as OrganizationSession | undefined)
      ?.activeOrganizationId
    if (!activeOrganizationId) {
      return NextResponse.json({ error: 'Active organization is required' }, { status: 400 })
    }

    const [{ billingEnabled }, canManageSso, organizationBillingData] = await Promise.all([
      getBillingGateState(),
      isOrganizationOwnerOrAdmin(session.user.id, activeOrganizationId),
      getOrganizationBillingData(activeOrganizationId),
    ])
    const access = getOrganizationAccessState({
      billingEnabled,
      hasOrganization: true,
      isOrganizationAdmin: canManageSso,
      organizationTier: organizationBillingData?.subscriptionTier,
    })

    if (!access.canManageOrganization) {
      return NextResponse.json(
        { error: 'Only organization owners and admins can manage SSO' },
        { status: 403 }
      )
    }

    if (!access.canConfigureSso) {
      return NextResponse.json(
        { error: 'Single Sign-On is not enabled for this organization' },
        { status: 403 }
      )
    }

    const results = await db
      .select({
        id: ssoProvider.id,
        providerId: ssoProvider.providerId,
        domain: ssoProvider.domain,
        domainVerified: ssoProvider.domainVerified,
        issuer: ssoProvider.issuer,
        oidcConfig: ssoProvider.oidcConfig,
      })
      .from(ssoProvider)
      .where(eq(ssoProvider.organizationId, activeOrganizationId))

    const providers = results.map((provider) => ({
      id: provider.id,
      providerId: provider.providerId,
      domain: provider.domain,
      domainVerified: provider.domainVerified,
      dnsRecordNames: getDnsRecordNames(provider.providerId, provider.domain),
      issuer: provider.issuer,
      providerType: provider.oidcConfig ? 'oidc' : 'saml',
    }))

    logger.info('Fetched SSO providers', {
      userId: session.user.id,
      authenticated: true,
      organizationId: activeOrganizationId,
      providerCount: providers.length,
    })

    return NextResponse.json({ providers })
  } catch (error) {
    logger.error('Failed to fetch SSO providers', { error })
    return NextResponse.json({ error: 'Failed to fetch SSO providers' }, { status: 500 })
  }
}
