import { db, ssoProvider } from '@tradinggoose/db'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { requireSsoOrganization } from '@/lib/sso/management'

const logger = createLogger('SSO-Providers')

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

    const activeOrganizationId = await requireSsoOrganization(session)

    const results = await db
      .select({
        id: ssoProvider.id,
        providerId: ssoProvider.providerId,
        domain: ssoProvider.domain,
        issuer: ssoProvider.issuer,
        domainVerified: ssoProvider.domainVerified,
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
      domainVerified: provider.domainVerified === true,
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
    if (error instanceof APIError)
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    logger.error('Failed to fetch SSO providers', { error })
    return NextResponse.json({ error: 'Failed to fetch SSO providers' }, { status: 500 })
  }
}
