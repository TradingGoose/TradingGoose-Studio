import { type SSOOptions, sso } from '@better-auth/sso'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { testUtils } from 'better-auth/plugins'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/env', async (original) => {
  const actual = await original<typeof import('@/lib/env')>()
  return { ...actual, env: { ...actual.env, SSO_ENABLED: true } }
})

import { auth as productionAuth } from '@/lib/auth'
import { SSO_PROVIDER_IDS } from '@/lib/sso/consts'

// Adapted from Better Auth v1.6.34 packages/sso/src/oidc.test.ts.
const baseURL = 'http://localhost:3000'
const issuer = 'https://93.184.215.14'
const localEmail = 'local@example.com'
const profile = { sub: 'stable-subject', email: localEmail, name: 'SSO User', email_verified: true }

async function setup() {
  const options: BetterAuthOptions = productionAuth.options
  const plugin = options.plugins?.find((plugin) => plugin.id === 'sso')
  if (!plugin) throw new Error('The production SSO plugin must be enabled')
  const ssoOptions = plugin.options as SSOOptions | undefined
  expect(ssoOptions?.domainVerification?.enabled).not.toBe(true)
  expect(ssoOptions?.trustEmailVerified).not.toBe(true)
  const auth = betterAuth({
    baseURL,
    secret: 'native-sso-account-matching-test-secret-long-enough',
    user: options.user,
    account: options.account,
    trustedOrigins: options.trustedOrigins,
    plugins: [sso(ssoOptions), testUtils()],
  })
  const context = await auth.$context
  expect(context.isTrustedOrigin(issuer)).toBe(false)
  await context.test.saveUser(
    context.test.createUser({
      id: 'provider-owner',
      email: 'admin@admin.example.com',
      emailVerified: true,
    })
  )
  await context.test.saveUser(
    context.test.createUser({ id: 'local-user', email: localEmail, emailVerified: true })
  )
  const { headers } = await context.test.login({ userId: 'provider-owner' })
  const register = (providerId = 'okta', providerType: 'oidc' | 'saml' = 'oidc') =>
    auth.api.registerSSOProvider({
      headers,
      body: {
        providerId,
        issuer,
        domain: 'example.com',
        ...(providerType === 'saml'
          ? {
              samlConfig: {
                entryPoint: `${issuer}/saml`,
                cert: 'test-certificate',
                callbackUrl: `${baseURL}/api/auth/sso/saml2/sp/acs/${providerId}`,
                spMetadata: {},
              },
            }
          : {
              oidcConfig: {
                clientId: 'client',
                clientSecret: 'secret',
                pkce: true,
                skipDiscovery: true,
                authorizationEndpoint: `${issuer}/authorize`,
                tokenEndpoint: `${issuer}/token`,
                userInfoEndpoint: `${issuer}/userinfo`,
                jwksEndpoint: `${issuer}/jwks`,
              },
            }),
      },
    })
  const callback = async () => {
    const start = await auth.api.signInSSO({
      body: { providerId: 'okta', callbackURL: `${baseURL}/workspace` },
      asResponse: true,
    })
    expect(start.status).toBe(200)
    const authorization = new URL((await start.json()).url)
    return auth.handler(
      new Request(
        `${baseURL}/api/auth/sso/callback/okta?code=valid-code&state=${authorization.searchParams.get('state')}`,
        { headers: { cookie: cookies(start) } }
      )
    )
  }
  return { auth, context, register, callback }
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      switch (url) {
        case `${issuer}/token`:
          return Response.json({
            access_token: 'access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          })
        case `${issuer}/userinfo`:
          return Response.json(profile)
        default:
          throw new Error(`Unexpected IdP request: ${url}`)
      }
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('native SSO registration and account matching', () => {
  it.each(SSO_PROVIDER_IDS)(
    'registers the offered %s provider without OAuth namespace trust',
    async (providerId) => {
      const { register } = await setup()
      await expect(register(providerId)).resolves.toMatchObject({ providerId })
    }
  )

  it('registers SAML while retaining the native reserved OAuth namespace restriction', async () => {
    const { register } = await setup()
    await expect(register('okta-saml', 'saml')).resolves.toMatchObject({ providerId: 'okta-saml' })
    for (const providerId of ['credential', 'google', 'github-repo']) {
      await expect(register(providerId)).rejects.toMatchObject({ statusCode: 422 })
    }
  })

  it('does not first-link a verified local account using an untrusted IdP email claim', async () => {
    const { auth, context, register, callback } = await setup()
    await register()
    const response = await callback()
    expect(new URL(response.headers.get('location')!, baseURL).searchParams.get('error')).toBe(
      'account not linked'
    )
    await expect(context.internalAdapter.findAccounts('local-user')).resolves.toEqual([])
    await expect(context.internalAdapter.listSessions('local-user')).resolves.toEqual([])
    await expect(
      auth.api.getSession({ headers: { cookie: cookies(response) } })
    ).resolves.toBeNull()
  })

  it('keeps an existing linked subject on the same account after its local email changes', async () => {
    const { auth, context, register, callback } = await setup()
    await register()
    await context.internalAdapter.linkAccount({
      userId: 'local-user',
      providerId: 'okta',
      accountId: profile.sub,
    })
    await context.internalAdapter.updateUser('local-user', { email: 'moved@elsewhere.com' })
    const returning = await callback()
    await expect(
      auth.api.getSession({ headers: { cookie: cookies(returning) } })
    ).resolves.toMatchObject({ user: { id: 'local-user', email: 'moved@elsewhere.com' } })
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `${issuer}/token`,
      `${issuer}/userinfo`,
    ])
  })
})
