import { discoverOIDCConfig } from '@better-auth/sso'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth, getSession } from '@/lib/auth'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
} from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { validateExternalUrl } from '@/lib/security/input-validation'
import { ssoProviderIdSchema } from '@/lib/sso/consts'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('SSO-Register')

type OrganizationSession = {
  activeOrganizationId?: string | null
}

const mappingSchema = z
  .object({
    id: z.string().default('sub'),
    email: z.string().default('email'),
    name: z.string().default('name'),
    image: z.string().default('picture'),
  })
  .default({
    id: 'sub',
    email: 'email',
    name: 'name',
    image: 'picture',
  })

const ssoRegistrationSchema = z.discriminatedUnion('providerType', [
  z.strictObject({
    providerType: z.literal('oidc'),
    providerId: ssoProviderIdSchema,
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    mapping: mappingSchema,
    clientId: z.string().min(1, 'Client ID is required for OIDC'),
    clientSecret: z.string().min(1, 'Client Secret is required for OIDC'),
    scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
    pkce: z.boolean().default(true),
  }),
  z.strictObject({
    providerType: z.literal('saml'),
    providerId: ssoProviderIdSchema,
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    mapping: mappingSchema,
    entryPoint: z.string().url('Entry point must be a valid URL for SAML'),
    cert: z.string().min(1, 'Certificate is required for SAML'),
    callbackUrl: z.string().url().optional(),
    audience: z.string().optional(),
    wantAssertionsSigned: z.boolean().optional(),
    signatureAlgorithm: z.string().optional(),
    digestAlgorithm: z.string().optional(),
    identifierFormat: z.string().optional(),
    idpMetadata: z.string().optional(),
  }),
])

export async function POST(request: NextRequest) {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }

    const session = await getSession(request.headers)
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

    const parseResult = ssoRegistrationSchema.safeParse(await request.json())

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]
      const registrationValidationMessage = firstError?.message || 'Validation failed'

      logger.warn('Invalid SSO registration request', {
        errors: parseResult.error.issues,
      })

      return NextResponse.json({ error: registrationValidationMessage }, { status: 400 })
    }

    const body = parseResult.data
    const { providerId, issuer, domain, providerType, mapping } = body

    const providerConfig: any = {
      providerId,
      issuer,
      domain,
      organizationId: activeOrganizationId,
    }

    if (providerType === 'oidc') {
      const { clientId, clientSecret, scopes, pkce } = body

      const oidcConfig: any = {
        clientId,
        clientSecret,
        scopes: scopes.filter((scope) => scope !== 'offline_access'),
        pkce,
        mapping,
        // Discovery is handled once here using the application's external URL policy.
        skipDiscovery: true,
      }

      try {
        Object.assign(
          oidcConfig,
          await discoverOIDCConfig({
            issuer,
            isTrustedOrigin: (url) => validateExternalUrl(url, 'OIDC URL').isValid,
          })
        )
      } catch (error) {
        logger.error('Error fetching OIDC discovery document', {
          error: error instanceof Error ? error.message : 'Unknown error',
          issuer,
        })
        return NextResponse.json(
          {
            error: 'Failed to fetch OIDC discovery document. Please verify the issuer URL.',
          },
          { status: 400 }
        )
      }

      providerConfig.oidcConfig = oidcConfig
    } else {
      const {
        entryPoint,
        cert,
        callbackUrl,
        audience,
        wantAssertionsSigned,
        signatureAlgorithm,
        digestAlgorithm,
        identifierFormat,
        idpMetadata,
      } = body

      const computedCallbackUrl =
        callbackUrl || `${getBaseUrl()}/api/auth/sso/saml2/sp/acs/${providerId}`

      const samlConfig: any = {
        entryPoint,
        cert,
        callbackUrl: computedCallbackUrl,
        spMetadata: {},
        mapping,
      }

      if (audience) samlConfig.audience = audience
      if (wantAssertionsSigned !== undefined) samlConfig.wantAssertionsSigned = wantAssertionsSigned
      if (signatureAlgorithm) samlConfig.signatureAlgorithm = signatureAlgorithm
      if (digestAlgorithm) samlConfig.digestAlgorithm = digestAlgorithm
      if (identifierFormat) samlConfig.identifierFormat = identifierFormat
      if (idpMetadata) {
        samlConfig.idpMetadata = {
          metadata: idpMetadata,
        }
      }

      providerConfig.samlConfig = samlConfig
    }

    const registration = await auth.api.registerSSOProvider({
      body: providerConfig,
      headers: request.headers,
    })

    logger.info('SSO provider registered successfully', {
      providerId,
      providerType,
      domain,
      organizationId: activeOrganizationId,
    })

    return NextResponse.json({
      success: true,
      providerId: registration.providerId,
      providerType,
      message: `${providerType.toUpperCase()} provider registered successfully`,
    })
  } catch (error) {
    logger.error('Failed to register SSO provider', {
      error,
      registrationFailureMessage: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      {
        error: 'Failed to register SSO provider',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
