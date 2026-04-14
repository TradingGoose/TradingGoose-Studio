import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth, getSession } from '@/lib/auth'
import { getOrganizationBillingData, isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { validateExternalUrl } from '@/lib/security/input-validation'

const logger = createLogger('SSO-Register')
const REDACTED_MARKER = '[REDACTED]'
const LEGACY_OIDC_OVERRIDE_FIELDS = [
  'authorizationEndpoint',
  'tokenEndpoint',
  'userInfoEndpoint',
  'jwksEndpoint',
] as const

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
  z.object({
    providerType: z.literal('oidc').default('oidc'),
    providerId: z.string().min(1, 'Provider ID is required'),
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    mapping: mappingSchema,
    clientId: z.string().min(1, 'Client ID is required for OIDC'),
    clientSecret: z.string().min(1, 'Client Secret is required for OIDC'),
    scopes: z
      .union([
        z.string().transform((value) =>
          value
            .split(',')
            .map((scope) => scope.trim())
            .filter((scope) => scope !== '')
        ),
        z.array(z.string()),
      ])
      .default(['openid', 'profile', 'email']),
    pkce: z.boolean().default(true),
  }),
  z.object({
    providerType: z.literal('saml'),
    providerId: z.string().min(1, 'Provider ID is required'),
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

function validateHttpsUrl(url: string, label: string) {
  const validation = validateExternalUrl(url, label)
  if (!validation.isValid) {
    return validation.error ?? `${label} is invalid`
  }

  return null
}

function getLegacyOidcOverrideFields(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  return LEGACY_OIDC_OVERRIDE_FIELDS.filter((field) => field in value)
}

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

    const rawBody = await request.json()
    const rawProviderType = rawBody?.providerType === 'saml' ? 'saml' : 'oidc'
    const legacyOidcOverrideFields =
      rawProviderType === 'oidc' ? getLegacyOidcOverrideFields(rawBody) : []

    if (legacyOidcOverrideFields.length > 0) {
      return NextResponse.json(
        {
          error: `Manual OIDC endpoint overrides are not supported: ${legacyOidcOverrideFields.join(', ')}. Configure OIDC using the issuer URL only.`,
        },
        { status: 400 }
      )
    }

    const parseResult = ssoRegistrationSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn('Invalid SSO registration request', {
        errors: parseResult.error.errors,
      })

      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    const body = parseResult.data
    const { providerId, issuer, domain, providerType, mapping } = body

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    const providerConfig: any = {
      providerId,
      issuer,
      domain,
      organizationId: activeOrganizationId,
    }

    if (providerType === 'oidc') {
      const {
        clientId,
        clientSecret,
        scopes,
        pkce,
      } = body

      const oidcConfig: any = {
        clientId,
        clientSecret,
        scopes: Array.isArray(scopes)
          ? scopes.filter((scope) => scope !== 'offline_access')
          : ['openid', 'profile', 'email'].filter((scope) => scope !== 'offline_access'),
        pkce: pkce ?? true,
        mapping,
      }

      const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
      const discoveryUrlError = validateHttpsUrl(discoveryUrl, 'OIDC discovery URL')
      if (discoveryUrlError) {
        logger.warn('OIDC discovery URL failed validation', {
          discoveryUrl,
          error: discoveryUrlError,
        })
        return NextResponse.json({ error: discoveryUrlError }, { status: 400 })
      }

      try {
        logger.info('Fetching OIDC discovery document', {
          discoveryUrl,
        })

        const discoveryResponse = await fetch(discoveryUrl, {
          headers: { Accept: 'application/json' },
        })

        if (!discoveryResponse.ok) {
          logger.error('Failed to fetch OIDC discovery document', {
            status: discoveryResponse.status,
          })
          return NextResponse.json(
            {
              error: 'Failed to fetch OIDC discovery document. Please verify the issuer URL.',
            },
            { status: 400 }
          )
        }

        const discovery = (await discoveryResponse.json()) as Record<string, unknown>

        const discoveredEndpoints: Record<string, unknown> = {
          authorization_endpoint: discovery.authorization_endpoint,
          token_endpoint: discovery.token_endpoint,
          userinfo_endpoint: discovery.userinfo_endpoint,
          jwks_uri: discovery.jwks_uri,
        }

        for (const [key, value] of Object.entries(discoveredEndpoints)) {
          if (typeof value !== 'string') {
            continue
          }

          const endpointError = validateHttpsUrl(value, `OIDC ${key}`)
          if (endpointError) {
            logger.warn('OIDC discovered endpoint failed validation', {
              endpoint: key,
              url: value,
              error: endpointError,
            })
            return NextResponse.json(
              {
                error: `Discovered OIDC ${key} failed security validation: ${endpointError}`,
              },
              { status: 400 }
            )
          }
        }

        oidcConfig.authorizationEndpoint = discovery.authorization_endpoint
        oidcConfig.tokenEndpoint = discovery.token_endpoint
        oidcConfig.userInfoEndpoint = discovery.userinfo_endpoint
        oidcConfig.jwksEndpoint = discovery.jwks_uri

        logger.info('Resolved OIDC endpoints from discovery', {
          providerId,
          issuer,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          userInfoEndpoint: oidcConfig.userInfoEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
        })
      } catch (error) {
        logger.error('Error fetching OIDC discovery document', {
          error: error instanceof Error ? error.message : 'Unknown error',
          discoveryUrl,
        })
        return NextResponse.json(
          {
            error: 'Failed to fetch OIDC discovery document. Please verify the issuer URL.',
          },
          { status: 400 }
        )
      }

      if (
        !oidcConfig.authorizationEndpoint ||
        !oidcConfig.tokenEndpoint ||
        !oidcConfig.jwksEndpoint
      ) {
        const missing: string[] = []
        if (!oidcConfig.authorizationEndpoint) missing.push('authorizationEndpoint')
        if (!oidcConfig.tokenEndpoint) missing.push('tokenEndpoint')
        if (!oidcConfig.jwksEndpoint) missing.push('jwksEndpoint')

        logger.error('Missing required OIDC endpoints after discovery', {
          missing,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
        })
        return NextResponse.json(
          {
            error: `Missing required OIDC endpoints from discovery: ${missing.join(', ')}. Please verify the issuer supports OIDC discovery.`,
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
        callbackUrl || `${issuer.replace('/metadata', '')}/callback/${providerId}`

      const escapeXml = (value: string) =>
        value.replace(/[<>&"']/g, (character) => {
          switch (character) {
            case '<':
              return '&lt;'
            case '>':
              return '&gt;'
            case '&':
              return '&amp;'
            case '"':
              return '&quot;'
            case "'":
              return '&apos;'
            default:
              return character
          }
        })

      const spMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(issuer)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(computedCallbackUrl)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`

      const samlConfig: any = {
        entryPoint,
        cert,
        callbackUrl: computedCallbackUrl,
        spMetadata: {
          metadata: spMetadataXml,
        },
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

    logger.info('Calling Better Auth registerSSOProvider with config:', {
      providerId: providerConfig.providerId,
      domain: providerConfig.domain,
      hasOidcConfig: !!providerConfig.oidcConfig,
      hasSamlConfig: !!providerConfig.samlConfig,
      samlConfigKeys: providerConfig.samlConfig ? Object.keys(providerConfig.samlConfig) : [],
      fullConfig: JSON.stringify(
        {
          ...providerConfig,
          oidcConfig: providerConfig.oidcConfig
            ? {
                ...providerConfig.oidcConfig,
                clientSecret: REDACTED_MARKER,
              }
            : undefined,
          samlConfig: providerConfig.samlConfig
            ? {
                ...providerConfig.samlConfig,
                cert: REDACTED_MARKER,
              }
            : undefined,
        },
        null,
        2
      ),
    })

    const registration = await auth.api.registerSSOProvider({
      body: providerConfig,
      headers,
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
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorDetails: JSON.stringify(error),
    })

    return NextResponse.json(
      {
        error: 'Failed to register SSO provider',
        details: error instanceof Error ? error.message : 'Unknown error',
        fullError: JSON.stringify(error),
      },
      { status: 500 }
    )
  }
}
