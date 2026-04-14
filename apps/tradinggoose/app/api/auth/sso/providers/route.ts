import { db, ssoProvider } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getOrganizationBillingData, isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'

const logger = createLogger('SSO-Providers')

type OrganizationSession = {
  activeOrganizationId?: string | null
}

function getProviderType(provider: {
  oidcConfig: string | null
  samlConfig: string | null
}): 'oidc' | 'saml' {
  if (provider.oidcConfig) {
    return 'oidc'
  }

  if (provider.samlConfig) {
    return 'saml'
  }

  return 'oidc'
}

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      const results = await db
        .select({
          domain: ssoProvider.domain,
        })
        .from(ssoProvider)

      const providers = results.map((provider) => ({
        domain: provider.domain,
      }))

      logger.info('Fetched SSO providers', {
        userId: null,
        authenticated: false,
        providerCount: providers.length,
      })

      return NextResponse.json({ providers })
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
        issuer: ssoProvider.issuer,
        oidcConfig: ssoProvider.oidcConfig,
        samlConfig: ssoProvider.samlConfig,
        organizationId: ssoProvider.organizationId,
      })
      .from(ssoProvider)
      .where(eq(ssoProvider.organizationId, activeOrganizationId))

    const providers = results.map((provider) => ({
      id: provider.id,
      providerId: provider.providerId,
      domain: provider.domain,
      issuer: provider.issuer,
      organizationId: provider.organizationId,
      providerType: getProviderType(provider),
      hasOidcConfig: Boolean(provider.oidcConfig),
      hasSamlConfig: Boolean(provider.samlConfig),
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
