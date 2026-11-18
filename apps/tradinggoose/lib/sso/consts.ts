import { z } from 'zod'

// Better Auth's default `_better-auth-token-` prefix uses 19 of the 63 DNS-label characters.
export const SSO_PROVIDER_ID_MAX_LENGTH = 44
export const ssoProviderIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Provider ID is required.')
  .max(
    SSO_PROVIDER_ID_MAX_LENGTH,
    `Provider ID must be at most ${SSO_PROVIDER_ID_MAX_LENGTH} characters.`
  )
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use letters and numbers with optional internal dashes.'
  )

export const SSO_PROVIDER_IDS = [
  'okta',
  'okta-saml',
  'okta-prod',
  'okta-dev',
  'okta-staging',
  'okta-test',
  'azure-ad',
  'azure-active-directory',
  'azure-corp',
  'azure-enterprise',
  'adfs',
  'adfs-company',
  'adfs-corp',
  'adfs-enterprise',
  'auth0',
  'auth0-prod',
  'auth0-dev',
  'auth0-staging',
  'onelogin',
  'onelogin-prod',
  'onelogin-corp',
  'jumpcloud',
  'jumpcloud-prod',
  'jumpcloud-corp',
  'ping-identity',
  'ping-federate',
  'pingone',
  'shibboleth',
  'shibboleth-idp',
  'google-workspace',
  'google-sso',
  'saml',
  'saml2',
  'saml-sso',
  'oidc',
  'oidc-sso',
  'openid-connect',
  'custom-sso',
  'enterprise-sso',
  'company-sso',
]
