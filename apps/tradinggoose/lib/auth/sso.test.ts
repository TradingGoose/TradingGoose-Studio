import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { type SSOOptions, sso } from '@better-auth/sso'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { organization, testUtils } from 'better-auth/plugins'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const billingMocks = vi.hoisted(() => ({
  getBillingGateState: vi.fn(),
  getOrganizationBillingData: vi.fn(),
  isOrganizationOwnerOrAdmin: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: billingMocks.getOrganizationBillingData,
  isOrganizationOwnerOrAdmin: billingMocks.isOrganizationOwnerOrAdmin,
}))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/billing/settings', async (original) => ({
  ...(await original<typeof import('@/lib/billing/settings')>()),
  getBillingGateState: billingMocks.getBillingGateState,
}))
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
    issuer: providerType === 'saml' ? baseURL : issuer,
    domain: 'example.com',
    organizationId,
    ...(providerType === 'saml'
      ? {
          samlConfig: {
            entryPoint: `${issuer}/saml`,
            cert: 'test-certificate',
            idpMetadata: { entityID: issuer },
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
  const verify = async (providerId = 'okta', domains = ['example.com']) => {
    const { domainVerificationToken } = await auth.api.requestDomainVerification({
      headers,
      body: { providerId },
    })
    const hosts = domains.map((domain) => `_better-auth-token-${providerId}.${domain}`)
    resolveTxt.mockImplementation(async (host: string) =>
      hosts.includes(host) ? [[domainVerificationToken]] : []
    )
    await expect(
      auth.api.verifyDomain({ headers, body: { providerId }, asResponse: true })
    ).resolves.toMatchObject({ status: 204 })
    for (const host of hosts) expect(resolveTxt).toHaveBeenCalledWith(host)
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
  billingMocks.getBillingGateState.mockReset().mockResolvedValue({ billingEnabled: true })
  billingMocks.getOrganizationBillingData.mockReset().mockResolvedValue({
    subscriptionTier: { ownerType: 'organization', canConfigureSso: true },
  })
  billingMocks.isOrganizationOwnerOrAdmin.mockReset().mockResolvedValue(true)
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
  it.each(['a'.repeat(44), 'a'.repeat(45), 'company/sso', 'team.sso', 'team_sso'])(
    'validates DNS and callback boundaries for provider ID %s',
    async (providerId) => {
      const { auth, context, headers, register, registrationBody, verify } = await setup()
      if (providerId.length === 44) {
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
    await expect(register(' OKTA-SAML ', 'saml')).resolves.toMatchObject({
      providerId: 'okta-saml',
    })
    for (const providerId of ['credential', 'google']) {
      await expect(register(providerId)).rejects.toMatchObject({ statusCode: 422 })
    }
    for (const providerId of ['github-repo', ' Trello ']) {
      await expect(register(providerId)).rejects.toMatchObject({
        statusCode: 400,
        body: { code: 'INVALID_PROVIDER_ID' },
      })
    }
  })

  it('refuses unverified providers and leaves failed DNS verification untrusted', async () => {
    const { auth, context, headers, register } = await setup()
    await register()
    for (const identifier of [{ providerId: 'okta' }, { email: localEmail }]) {
      await expect(
        auth.api.signInSSO({ body: { ...identifier, callbackURL: '/workspace' } })
      ).rejects.toMatchObject({ statusCode: 401 })
    }
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

  it('supports a verified multi-domain provider when an unverified provider claims an exact match', async () => {
    const { auth, context, headers, registrationBody, register, verify } = await setup()
    await auth.api.registerSSOProvider({
      headers,
      body: { ...registrationBody('okta-prod'), domain: 'https://EXAMPLE.com/path,other.example' },
    })
    await verify('okta-prod', ['example.com', 'other.example'])
    await register('okta')
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        context.adapter.create({
          model: 'ssoProvider',
          data: {
            providerId: `a-provider-${i}`,
            issuer,
            userId: 'provider-owner',
            domain: 'other.example.org',
            domainVerified: true,
          },
        })
      )
    )
    const signIn = (providerId?: string, email = localEmail) =>
      auth.api.signInSSO({ body: { email, providerId, callbackURL: '/workspace' } })
    const redirectUri = (url: string) => new URL(url).searchParams.get('redirect_uri')
    const verifiedCallback = `${baseURL}/api/auth/sso/callback/okta-prod`
    expect(redirectUri((await signIn()).url)).toBe(verifiedCallback)
    expect(redirectUri((await signIn(undefined, 'member@sub.other.example')).url)).toBe(
      verifiedCallback
    )
    await expect(signIn('okta')).rejects.toMatchObject({ statusCode: 401 })
    expect(redirectUri((await signIn('okta-prod')).url)).toBe(verifiedCallback)

    await verify('okta')
    expect(redirectUri((await signIn()).url)).toBe(`${baseURL}/api/auth/sso/callback/okta`)
    await expect(signIn(undefined, 'member@sub.example.com')).rejects.toMatchObject({
      statusCode: 409,
      body: { code: 'SSO_PROVIDER_ID_REQUIRED' },
    })
    expect(redirectUri((await signIn('okta-prod', 'member@sub.example.com')).url)).toBe(
      verifiedCallback
    )
  })

  it('requires a provider ID when verified exact domains differ only in case', async () => {
    const { auth, headers, register, registrationBody, verify } = await setup()
    await register('okta')
    await auth.api.registerSSOProvider({
      headers,
      body: { ...registrationBody('okta-prod'), domain: 'Example.com' },
    })
    await verify('okta')
    await verify('okta-prod')
    const body = { email: localEmail, callbackURL: '/workspace' }
    await expect(auth.api.signInSSO({ body })).rejects.toMatchObject({
      statusCode: 409,
      body: { code: 'SSO_PROVIDER_ID_REQUIRED' },
    })
    const { url } = await auth.api.signInSSO({ body: { ...body, providerId: 'okta-prod' } })
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      `${baseURL}/api/auth/sso/callback/okta-prod`
    )
  })

  it('signs in a linked SSO subject after their Studio email changes', async () => {
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
    const mailbox = { email: 'moved@elsewhere.com', emailVerified: true }
    await context.internalAdapter.updateUser('local-user', mailbox)
    const returning = await callback()
    await expect(
      auth.api.getSession({ headers: { cookie: cookies(returning) } })
    ).resolves.toMatchObject({
      user: { id: 'local-user', email: mailbox.email },
    })
    await expect(context.internalAdapter.findUserById('local-user')).resolves.toMatchObject(mailbox)
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

  it('allows a downgraded owner to retire a provider while blocking configuration', async () => {
    const { auth, context, headers, register } = await setup()
    await register()
    billingMocks.getOrganizationBillingData.mockResolvedValue({
      subscriptionTier: { ownerType: 'organization', canConfigureSso: false },
    })

    for (const endpoint of [
      auth.api.requestDomainVerification,
      auth.api.verifyDomain,
      auth.api.updateSSOProvider,
    ]) {
      await expect(endpoint({ headers, body: { providerId: 'okta' } })).rejects.toMatchObject({
        statusCode: 403,
        body: { message: 'Single Sign-On is not enabled for this organization' },
      })
    }
    expect(billingMocks.getOrganizationBillingData).toHaveBeenCalledWith(organizationId)
    expect(resolveTxt).not.toHaveBeenCalled()
    await context.test.addMember!({ userId: 'local-user', organizationId, role: 'member' })
    const member = await context.test.getAuthHeaders({ userId: 'local-user' })
    const body = { providerId: 'okta' }
    await expect(auth.api.deleteSSOProvider({ headers: member, body })).rejects.toMatchObject({
      statusCode: 403,
    })
    await expect(auth.api.deleteSSOProvider({ headers, body })).resolves.toEqual({ success: true })
  })

  it('lets an organization administrator verify its provider with billing disabled', async () => {
    const { register, verify } = await setup()
    billingMocks.getBillingGateState.mockResolvedValue({ billingEnabled: false })
    billingMocks.getOrganizationBillingData.mockResolvedValue(null)

    await register()
    await verify()
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
