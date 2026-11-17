import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { type SSOOptions, sso } from '@better-auth/sso'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { organization, testUtils } from 'better-auth/plugins'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/env', async (original) => {
  const actual = await original<typeof import('@/lib/env')>()
  return { ...actual, env: { ...actual.env, SSO_ENABLED: true } }
})

import { auth as productionAuth } from '@/lib/auth'
import { SSO_PROVIDER_IDS } from '@/lib/sso/consts'

// Adapted from Better Auth v1.6.34 packages/sso/src/{oidc,domain-verification}.test.ts.
const baseURL = 'http://localhost:3000'
const issuer = 'https://93.184.215.14'
const localEmail = 'local@example.com'
const organizationId = 'org-sso'
const profile = { sub: 'stable-subject', email: localEmail, name: 'SSO User', email_verified: true }
const resolveTxt = vi.fn()

async function setup(email = localEmail, emailVerified = true) {
  profile.email = email
  const options: BetterAuthOptions = productionAuth.options
  const plugin = options.plugins?.find((plugin) => plugin.id === 'sso')
  if (!plugin) throw new Error('The production SSO plugin must be enabled')
  const ssoOptions = plugin.options as SSOOptions & { domainVerification: { enabled: true } }
  expect(ssoOptions.domainVerification?.enabled).toBe(true)
  expect(ssoOptions.trustEmailVerified).not.toBe(true)
  expect(ssoOptions.organizationProvisioning?.disabled).toBe(true)
  const auth = betterAuth({
    baseURL,
    secret: 'native-sso-account-matching-test-secret-long-enough',
    user: options.user,
    account: options.account,
    trustedOrigins: options.trustedOrigins,
    hooks: options.hooks,
    plugins: [sso(ssoOptions), organization(), testUtils()],
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
  await context.test.saveUser(context.test.createUser({ id: 'local-user', email, emailVerified }))
  await context.test.saveOrganization!(context.test.createOrganization!({ id: organizationId }))
  await context.test.addMember!({ userId: 'provider-owner', organizationId, role: 'owner' })
  const { headers } = await context.test.login({ userId: 'provider-owner' })
  const registrationBody = (providerId = 'okta', providerType: 'oidc' | 'saml' = 'oidc') => ({
    providerId,
    issuer,
    domain: 'example.com',
    organizationId,
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
  })
  const register = (providerId = 'okta', providerType: 'oidc' | 'saml' = 'oidc') =>
    auth.api.registerSSOProvider({ headers, body: registrationBody(providerId, providerType) })
  const verify = async (providerId = 'okta') => {
    const { domainVerificationToken } = await auth.api.requestDomainVerification({
      headers,
      body: { providerId },
    })
    resolveTxt.mockResolvedValue([[domainVerificationToken]])
    await expect(
      auth.api.verifyDomain({ headers, body: { providerId }, asResponse: true })
    ).resolves.toMatchObject({ status: 204 })
    expect(resolveTxt).toHaveBeenCalledWith(`_better-auth-token-${providerId}.example.com`)
  }
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
  return { auth, context, headers, register, registrationBody, verify, callback }
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

beforeEach(() => {
  profile.email = localEmail
  resolveTxt.mockReset()
  vi.spyOn(dns, 'resolveTxt').mockImplementation(resolveTxt)
  syncBuiltinESMExports()
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
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  vi.unstubAllGlobals()
})

describe('native SSO registration and account matching', () => {
  it.each([44, 45, 47])(
    'enforces the DNS provider ID boundary at %i characters',
    async (length) => {
      const { auth, context, headers, register, registrationBody, verify } = await setup()
      const providerId = 'a'.repeat(length)
      if (length === 44) {
        await register(providerId)
        await verify(providerId)
        await expect(
          auth.api.getSSOProvider({ headers, query: { providerId } })
        ).resolves.toMatchObject({ domainVerified: true })
        return
      }

      await expect(register(providerId)).rejects.toMatchObject({
        statusCode: 400,
        body: { code: 'INVALID_PROVIDER_ID' },
      })
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sso/register`, {
          method: 'POST',
          headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
          body: JSON.stringify(registrationBody(providerId)),
        })
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_PROVIDER_ID' })
      for (const model of ['ssoProvider', 'verification']) {
        await expect(context.adapter.findMany({ model })).resolves.toEqual([])
      }
      expect(resolveTxt).not.toHaveBeenCalled()
    }
  )

  it.each(SSO_PROVIDER_IDS)(
    'registers the offered %s provider without OAuth namespace trust',
    async (providerId) => {
      const { register } = await setup()
      await expect(register(providerId)).resolves.toMatchObject({
        providerId,
        domainVerified: false,
      })
    }
  )

  it('registers SAML while retaining the native reserved OAuth namespace restriction', async () => {
    const { register } = await setup()
    await expect(register('okta-saml', 'saml')).resolves.toMatchObject({ providerId: 'okta-saml' })
    for (const providerId of ['credential', 'google', 'github-repo']) {
      await expect(register(providerId)).rejects.toMatchObject({ statusCode: 422 })
    }
  })

  it('refuses unverified providers and leaves failed DNS verification untrusted', async () => {
    const { auth, context, headers, register } = await setup()
    await register()
    await expect(
      auth.api.signInSSO({ body: { providerId: 'okta', callbackURL: '/workspace' } })
    ).rejects.toMatchObject({ statusCode: 401 })
    resolveTxt.mockResolvedValue([])
    await expect(
      auth.api.verifyDomain({ headers, body: { providerId: 'okta' } })
    ).rejects.toMatchObject({ statusCode: 502, body: { code: 'DOMAIN_VERIFICATION_FAILED' } })
    await expect(
      auth.api.getSSOProvider({ headers, query: { providerId: 'okta' } })
    ).resolves.toMatchObject({ domainVerified: false })
    await expect(context.internalAdapter.findAccounts('local-user')).resolves.toEqual([])
    await expect(context.internalAdapter.listSessions('local-user')).resolves.toEqual([])
  })

  it('first-links after native DNS verification and retains that subject after an email change', async () => {
    const { auth, context, register, verify, callback } = await setup()
    await register()
    await verify()
    const first = await callback()
    expect(first.headers.get('location')).toBe(`${baseURL}/workspace`)
    await expect(
      auth.api.getSession({ headers: { cookie: cookies(first) } })
    ).resolves.toMatchObject({ user: { id: 'local-user', email: localEmail } })
    await expect(context.internalAdapter.findAccounts('local-user')).resolves.toEqual([
      expect.objectContaining({ userId: 'local-user', providerId: 'okta', accountId: profile.sub }),
    ])
    await context.internalAdapter.updateUser('local-user', { email: 'moved@elsewhere.com' })
    const returning = await callback()
    await expect(
      auth.api.getSession({ headers: { cookie: cookies(returning) } })
    ).resolves.toMatchObject({ user: { id: 'local-user', email: 'moved@elsewhere.com' } })
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `${issuer}/token`,
      `${issuer}/userinfo`,
      `${issuer}/token`,
      `${issuer}/userinfo`,
    ])
  })

  it.each([
    [localEmail, false],
    ['outside@elsewhere.com', true],
  ] as const)(
    'refuses first linking for %s with local verification %s',
    async (email, emailVerified) => {
      const { auth, context, register, verify, callback } = await setup(email, emailVerified)
      await register()
      await verify()
      const response = await callback()
      expect(new URL(response.headers.get('location')!, baseURL).searchParams.get('error')).toBe(
        'account not linked'
      )
      await expect(context.internalAdapter.findAccounts('local-user')).resolves.toEqual([])
      await expect(context.internalAdapter.listSessions('local-user')).resolves.toEqual([])
      await expect(
        auth.api.getSession({ headers: { cookie: cookies(response) } })
      ).resolves.toBeNull()
    }
  )

  it.each(['owner', 'member'])(
    'first-links an existing organization %s without changing membership',
    async (role) => {
      const { auth, context, register, verify, callback } = await setup()
      await context.test.addMember!({ userId: 'local-user', organizationId, role })
      const members = () =>
        context.adapter.findMany({
          model: 'member',
          where: [{ field: 'organizationId', value: organizationId }],
        })
      const before = await members()
      await register()
      await verify()
      const response = await callback()
      await expect(
        auth.api.getSession({ headers: { cookie: cookies(response) } })
      ).resolves.toMatchObject({ user: { id: 'local-user' } })
      expect(await members()).toEqual(before)
    }
  )

  it('does not provision organization membership when native SSO creates a new user', async () => {
    const { auth, context, register, verify, callback } = await setup()
    await context.test.deleteUser('local-user')
    await register()
    await verify()
    const response = await callback()
    await expect(
      auth.api.getSession({ headers: { cookie: cookies(response) } })
    ).resolves.toMatchObject({ user: { email: localEmail } })
    await expect(context.adapter.findMany({ model: 'member' })).resolves.toEqual([
      expect.objectContaining({ userId: 'provider-owner', organizationId, role: 'owner' }),
    ])
  })

  it.each(['non-member', 'member'])(
    'denies a %s domain verification access before DNS resolution',
    async (role) => {
      const { auth, context, headers, register } = await setup()
      await register()
      if (role === 'member')
        await context.test.addMember!({ userId: 'local-user', organizationId, role })
      const unauthorized = await context.test.getAuthHeaders({ userId: 'local-user' })
      for (const endpoint of [auth.api.requestDomainVerification, auth.api.verifyDomain]) {
        await expect(
          endpoint({ headers: unauthorized, body: { providerId: 'okta' } })
        ).rejects.toMatchObject({ statusCode: 403 })
      }
      expect(resolveTxt).not.toHaveBeenCalled()
      await expect(
        auth.api.getSSOProvider({ headers, query: { providerId: 'okta' } })
      ).resolves.toMatchObject({ domainVerified: false })
    }
  )
})
