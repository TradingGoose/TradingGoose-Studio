import { hashPassword } from 'better-auth/crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAuthRequest } from '@/app/api/auth/[...all]/route'
import { auth } from './auth'
import { isHosted } from './environment'
import { getRobinhoodOAuthRedirectUri } from './oauth/robinhood-constants'

const { tables, resolveDefinitions, registerClient, origin } = vi.hoisted(() => {
  const origin = 'http://localhost:3000'
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
  vi.stubEnv('SSO_ENABLED', 'true')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-for-managed-oauth-fixture-only')
  return {
    origin,
    tables: {
      user: [],
      account: [],
      session: [],
      verification: [],
      member: [],
      ssoProvider: [],
    } as Record<string, Record<string, unknown>[]>,
    resolveDefinitions: vi.fn(),
    registerClient: vi.fn(),
  }
})

vi.mock('@/lib/billing/core/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/core/organization')>()),
  getOrganizationBillingData: vi.fn(async () => ({ subscriptionTier: null })),
  isOrganizationOwnerOrAdmin: vi.fn(async () => true),
}))
vi.mock('@/lib/billing/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/settings')>()),
  getBillingGateState: vi.fn(async () => ({ billingEnabled: false })),
}))

vi.mock('better-auth/adapters/drizzle', async () => {
  const { memoryAdapter } = await import('better-auth/adapters/memory')
  return { drizzleAdapter: () => memoryAdapter(tables) }
})
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/system-integrations/resolver', () => ({
  resolveSystemIntegrationDefinitions: resolveDefinitions,
}))

const password = 'test account password'
function request(path: string, body?: object, cookie = '') {
  return handleAuthRequest(
    new Request(`${origin}/api/auth${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { origin, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  )
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

async function signIn(userId: string) {
  const email = `${userId}@example.test`
  const date = new Date()
  tables.user.push({
    id: userId,
    email,
    name: userId,
    emailVerified: true,
    createdAt: date,
    updatedAt: date,
  })
  tables.account.push({
    id: `password-${userId}`,
    accountId: userId,
    userId,
    providerId: 'credential',
    password: await hashPassword(password),
    createdAt: date,
    updatedAt: date,
  })
  const response = await request('/sign-in/email', { email, password })
  expect(response.status).toBe(200)
  return cookies(response)
}

async function startLink(provider: string, session: string, destination: string) {
  const response = await request(
    '/link-social',
    { provider, callbackURL: destination, errorCallbackURL: destination },
    session
  )
  expect(response.status).toBe(200)
  return {
    url: new URL((await response.json()).url),
    cookie: [session, cookies(response)].join('; '),
  }
}

function completeLink(provider: string, link: Awaited<ReturnType<typeof startLink>>, code: string) {
  return request(
    `/callback/${provider}?code=${code}&state=${link.url.searchParams.get('state')}`,
    undefined,
    link.cookie
  )
}

describe('managed OAuth through the auth handler', () => {
  beforeEach(() => {
    for (const table of Object.keys(tables)) tables[table] = []
    registerClient.mockReset()
    resolveDefinitions.mockReset().mockResolvedValue({})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts with optional providers unconfigured and reads a password session from its cookie', async () => {
    const session = await signIn('password-user')
    const response = await request('/get-session', undefined, session)
    expect((await response.json()).user.id).toBe('password-user')
    expect(resolveDefinitions).not.toHaveBeenCalled()
  })

  it('keeps concurrent Robinhood registrations, token exchanges and saved accounts with their initiating users', async () => {
    resolveDefinitions.mockResolvedValue({ robinhood: { isEnabled: true, secrets: {} } })
    let registrations = 0
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: `registration-${++registrations}`,
    }))
    const exchanges: Record<string, string | null> = {}
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const outgoing = new Request(input, init)
      expect(outgoing.url).toBe('https://api.robinhood.com/oauth2/token/')
      const body = new URLSearchParams(await outgoing.text())
      const code = body.get('code')!
      exchanges[code] = body.get('client_id')
      expect(body.get('redirect_uri')).toBe(getRobinhoodOAuthRedirectUri(origin, isHosted))
      return Response.json({
        access_token: `access-${code}`,
        refresh_token: `refresh-${code}`,
        token_type: 'Bearer',
        user_uuid: code,
      })
    })

    expect((await request('/link-social', { provider: 'robinhood' })).status).toBe(401)
    expect(registerClient).not.toHaveBeenCalled()
    const users = ['alice', 'bob']
    const sessions = await Promise.all(users.map(signIn))
    const links = await Promise.all(
      sessions.map((session, index) =>
        startLink('robinhood', session, `/workspace/${users[index]}`)
      )
    )
    const ids = links.map(({ url }) => url.searchParams.get('client_id'))
    expect(new Set(ids)).toEqual(new Set(['registration-1', 'registration-2']))
    const callbacks = await Promise.all(
      links.map((link, index) => completeLink('robinhood', link, users[index]))
    )
    for (const [index, userId] of users.entries()) {
      expect(callbacks[index].headers.get('location')).toBe(`/workspace/${userId}`)
      expect(exchanges[userId]).toBe(ids[index])
      expect(tables.account).toContainEqual(
        expect.objectContaining({
          providerId: 'robinhood',
          userId,
          accountId: userId,
          oauthClientId: ids[index],
          refreshToken: `refresh-${userId}`,
        })
      )
    }
  })

  it('uses current managed credentials for discovery, ID-token verification and the linked account', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const issuer = 'https://accounts.google.com'
    const provider = 'google-email'
    let clientId = 'first-client'
    let nonce: string | null = null
    resolveDefinitions.mockImplementation(async () => ({
      [provider]: {
        isEnabled: true,
        secrets: { client_id: clientId, client_secret: 'configured-secret' },
      },
    }))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const outgoing = new Request(input, init)
      switch (new URL(outgoing.url).pathname) {
        case '/.well-known/openid-configuration':
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/keys`,
            id_token_signing_alg_values_supported: ['RS256'],
          })
        case '/keys':
          return Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] })
        case '/token': {
          const body = new URLSearchParams(await outgoing.text())
          expect(body.get('client_id')).toBe(clientId)
          expect(body.get('client_secret')).toBe('configured-secret')
          const idToken = await new SignJWT({
            nonce,
            email: 'owner@example.test',
            email_verified: true,
            name: 'Owner',
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(issuer)
            .setSubject('google-user')
            .setAudience(clientId)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
          return Response.json({ id_token: idToken, access_token: 'access', token_type: 'Bearer' })
        }
        default:
          throw new Error(`Unexpected fixture URL ${outgoing.url}`)
      }
    })
    const session = await signIn('owner')
    for (const id of ['first-client', 'rotated-client']) {
      clientId = id
      const link = await startLink(provider, session, '/workspace')
      expect(link.url.searchParams.get('client_id')).toBe(id)
      expect(link.url.searchParams.get('redirect_uri')).toBe(
        `${origin}/api/auth/callback/${provider}`
      )
      nonce = link.url.searchParams.get('nonce')
      expect(nonce).toBeTruthy()
      const response = await completeLink(provider, link, 'code')
      expect(response.headers.get('location')).toBe('/workspace')
    }
    expect(tables.account.filter((account) => account.providerId === provider)).toEqual([
      expect.objectContaining({ userId: 'owner', accountId: 'google-user' }),
    ])
  })

  it('preserves the client registration until a replacement refresh token is available', async () => {
    const { runWithSystemOAuthClientCredentials } = await import('./oauth/system-managed-config')
    const update = auth.options.databaseHooks.account.update.before
    await runWithSystemOAuthClientCredentials(
      async () => {
        expect(await update({ accessToken: 'new-access' })).toBeUndefined()
        expect(await update({ refreshToken: 'new-refresh' })).toEqual({
          data: { refreshToken: 'new-refresh', oauthClientId: 'new-client' },
        })
      },
      { robinhood: { clientId: 'new-client', clientSecret: '', fields: {} } }
    )
  })

  it('returns a declined consent to the initiating workspace with query and fragment intact', async () => {
    resolveDefinitions.mockResolvedValue({ robinhood: { isEnabled: true, secrets: {} } })
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
    const destination = '/workspace/one/integrations?oauth_connected=robinhood#node=2'
    const link = await startLink('robinhood', await signIn('owner'), destination)
    const result = await request(
      `/callback/robinhood?error=access_denied&error_description=User+denied+access&state=${link.url.searchParams.get('state')}`,
      undefined,
      link.cookie
    )
    expect(result.headers.get('location')).toBe(
      '/workspace/one/integrations?oauth_connected=robinhood&error=access_denied&error_description=User+denied+access#node=2'
    )
    expect(tables.account.filter((account) => account.providerId === 'robinhood')).toHaveLength(0)
  })
})

describe('SSO domain verification access', () => {
  it('reserves managed OAuth IDs on the native SSO registration endpoint', async () => {
    const cookie = await signIn('managed-provider-owner')
    expect((await auth.$context).socialProviders.map(({ id }) => id)).not.toContain('tradier-live')
    const outgoing = vi.fn()
    vi.stubGlobal('fetch', outgoing)
    try {
      const result = await request(
        '/sso/register',
        {
          providerId: 'tradier-live',
          issuer: 'https://idp.example.com',
          domain: 'example.com',
          oidcConfig: { clientId: 'client', clientSecret: 'secret' },
        },
        cookie
      )
      expect(result.status).toBe(422)
      expect(outgoing).not.toHaveBeenCalled()
      expect(tables.ssoProvider).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requires an eligible active organization that owns the provider', async () => {
    const { getBillingGateState } = await import('@/lib/billing/settings')
    for (const table of Object.keys(tables)) tables[table] = []
    const cookie = await signIn('sso-owner')
    tables.ssoProvider.push({
      id: 'provider-id',
      providerId: 'okta',
      userId: 'sso-owner',
      organizationId: 'org-b',
      domain: 'example.test',
    })
    tables.member.push({
      id: 'member-id',
      userId: 'sso-owner',
      organizationId: 'org-b',
      role: 'owner',
      createdAt: new Date(),
    })
    for (const path of ['/sso/request-domain-verification', '/sso/verify-domain']) {
      const call = () => request(path, { providerId: 'okta' }, cookie)
      expect((await request(path, { providerId: 'okta' })).status).toBe(401)
      tables.session[0].activeOrganizationId = 'org-a'
      expect((await call()).status).toBe(404)
      tables.session[0].activeOrganizationId = 'org-b'
      vi.mocked(getBillingGateState).mockResolvedValueOnce({
        billingEnabled: true,
        stripeConfigured: true,
      })
      expect((await call()).status).toBe(403)
    }
    expect(
      (await request('/sso/request-domain-verification', { providerId: 'okta' }, cookie)).status
    ).toBe(201)
  })
})
