import {
  computeDiscoveryUrl,
  fetchDiscoveryDocument,
  selectTokenEndpointAuthMethod,
  validateDiscoveryDocument,
} from '@better-auth/sso'
import { APIError } from 'better-auth/api'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth, getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { validateExternalUrl } from '@/lib/security/input-validation'
import { assertSsoProviderIdAllowed, requireSsoOrganization } from '@/lib/sso/management'

const logger = createLogger('SSO-Register')
const LEGACY_OIDC_OVERRIDE_FIELDS = [
  'authorizationEndpoint',
  'tokenEndpoint',
  'userInfoEndpoint',
  'jwksEndpoint',
] as const

const mappingSchema = z.object({
  email: z.string().default('email'),
  name: z.string().default('name'),
})

const ssoRegistrationSchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('oidc').default('oidc'),
    providerId: z.string().min(1, 'Provider ID is required'),
    issuer: z.string().url('Issuer must be a valid URL'),
    domain: z.string().min(1, 'Domain is required'),
    mapping: mappingSchema.extend({ image: z.string().default('picture') }).default({
      email: 'email',
      name: 'name',
      image: 'picture',
    }),
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
  z
    .object({
      providerType: z.literal('saml'),
      providerId: z.string().min(1, 'Provider ID is required'),
      issuer: z.string().url('Issuer must be a valid URL'),
      domain: z.string().min(1, 'Domain is required'),
      mapping: mappingSchema.default({ email: 'email', name: 'name' }),
      entryPoint: z.string().url('Entry point must be a valid URL for SAML'),
      cert: z.string().trim().min(1).optional(),
      idpEntityId: z.string().trim().min(1).optional(),
      audience: z.string().optional(),
      wantAssertionsSigned: z.boolean().optional(),
      signatureAlgorithm: z.string().optional(),
      digestAlgorithm: z.string().optional(),
      identifierFormat: z.string().optional(),
      idpMetadata: z.string().trim().min(1).optional(),
    })
    .refine(({ idpMetadata, idpEntityId, cert }) => idpMetadata || (idpEntityId && cert), {
      message: 'Provide IdP metadata XML or both the IdP entity ID and signing certificate.',
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
    const activeOrganizationId = await requireSsoOrganization(session)

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
      const firstError = parseResult.error.issues[0]
      const registrationValidationMessage = firstError?.message || 'Validation failed'

      logger.warn('Invalid SSO registration request', {
        errors: parseResult.error.issues,
      })

      return NextResponse.json({ error: registrationValidationMessage }, { status: 400 })
    }

    const body = parseResult.data
    const { providerId, issuer, domain, providerType } = body
    assertSsoProviderIdAllowed(providerId)
    const providerConfig: NonNullable<Parameters<typeof auth.api.registerSSOProvider>[0]>['body'] =
      {
        providerId,
        issuer,
        domain,
        organizationId: activeOrganizationId,
      }

    if (body.providerType === 'oidc') {
      const discoveryUrl = computeDiscoveryUrl(issuer)
      const discoveryError = validateHttpsUrl(discoveryUrl, 'OIDC discovery URL')
      if (discoveryError) return NextResponse.json({ error: discoveryError }, { status: 400 })

      try {
        const doc = await fetchDiscoveryDocument(discoveryUrl)
        validateDiscoveryDocument(doc, issuer)
        const endpoints = {
          authorizationEndpoint: doc.authorization_endpoint,
          tokenEndpoint: doc.token_endpoint,
          jwksEndpoint: doc.jwks_uri,
          userInfoEndpoint: doc.userinfo_endpoint,
        }
        for (const [name, url] of Object.entries(endpoints)) {
          if (url === undefined) continue
          const error = validateHttpsUrl(url, `OIDC ${name}`)
          if (error) return NextResponse.json({ error }, { status: 400 })
        }
        providerConfig.oidcConfig = {
          ...endpoints,
          skipDiscovery: true,
          tokenEndpointAuthentication: selectTokenEndpointAuthMethod(doc),
          clientId: body.clientId,
          clientSecret: body.clientSecret,
          scopes: body.scopes.filter((scope) => scope !== 'offline_access'),
          pkce: body.pkce,
          mapping: body.mapping,
        }
      } catch (error) {
        logger.warn('Invalid OIDC discovery document', { discoveryUrl, error })
        return NextResponse.json(
          { error: 'Invalid OIDC discovery document. Verify the issuer URL.' },
          { status: 400 }
        )
      }
    } else {
      providerConfig.samlConfig = {
        entryPoint: body.entryPoint,
        idpMetadata: body.idpMetadata
          ? { metadata: body.idpMetadata }
          : { entityID: body.idpEntityId },
        cert: body.cert,
        audience: body.audience,
        wantAssertionsSigned: body.wantAssertionsSigned,
        signatureAlgorithm: body.signatureAlgorithm,
        digestAlgorithm: body.digestAlgorithm,
        identifierFormat: body.identifierFormat,
        mapping: body.mapping,
      }
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
      domainVerificationToken: registration.domainVerificationToken,
      providerType,
      message: `${providerType.toUpperCase()} provider registered successfully`,
    })
  } catch (error) {
    if (error instanceof APIError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    logger.error('Failed to register SSO provider', { error })
    return NextResponse.json({ error: 'Failed to register SSO provider' }, { status: 500 })
  }
}
