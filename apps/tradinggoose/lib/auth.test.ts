import { type BetterAuthOptions, betterAuth, getAuthStateVerificationIdentifier } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { applySetCookies } from 'better-auth/cookies'
import { testUtils } from 'better-auth/plugins'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerClient } = vi.hoisted(() => ({ registerClient: vi.fn() }))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))
vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))

import { auth } from './auth'
import { isHosted } from './environment'
import { getRobinhoodOAuthRedirectUri } from './oauth/robinhood-constants'
import { runWithSystemOAuthClientCredentials } from './oauth/system-managed-config'
import { getBaseUrl } from './urls/utils'

const baseURL = 'http://localhost:3000'
const oauth = auth.options.plugins.find((plugin) => plugin.id === 'generic-oauth')!
const robinhood = oauth.options.config.find((provider) => provider.providerId === 'robinhood')!

async function setupLink(databaseHooks?: BetterAuthOptions['databaseHooks']) {
  const service = betterAuth({
    baseURL,
    secret: 'integration-link-test-secret-that-is-long-enough',
    account: auth.options.account,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    databaseHooks,
    plugins: [oauth, testUtils()],
  })
  const { test, internalAdapter } = await service.$context
  const user = await test.saveUser(test.createUser({ email: 'owner@example.com' }))
  const { headers } = await test.login({ userId: user.id })
  return { service, test, internalAdapter, user, headers }
}

function callbackRequest(provider: string, headers: Headers, params: Record<string, string>) {
  const callback = new URL(`/api/auth/callback/${provider}`, baseURL)
  callback.search = new URLSearchParams(params).toString()
  return new Request(callback, { headers })
}

describe('Robinhood OAuth linking', () => {
  beforeEach(() => {
    registerClient.mockReset()
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
  })

  it('uses the environment callback for authorization and token exchange', () => {
    expect(robinhood.redirectURI).toBe(getRobinhoodOAuthRedirectUri(getBaseUrl(), isHosted))
  })

  it('rejects token responses without a stable user identity', async () => {
    await expect(robinhood.getUserInfo!({ accessToken: 'access-token', raw: {} })).rejects.toThrow(
      'missing the user identity'
    )
  })

  it('registers the client after authentication and returns consent errors to the saved destination', async () => {
    const { service, internalAdapter, user, headers } = await setupLink({
      verification: auth.options.databaseHooks.verification,
    })
    const destination = '/workspace/workspace-1/integrations?oauth_connected=robinhood#node=2'
    const body = { provider: 'robinhood', callbackURL: destination, errorCallbackURL: destination }
    await expect(
      service.api.linkSocialAccount({ body, headers: new Headers() })
    ).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(registerClient).not.toHaveBeenCalled()
    const linked = await runWithSystemOAuthClientCredentials(
      () => service.api.linkSocialAccount({ body, headers, returnHeaders: true }),
      { robinhood: { clientId: '', clientSecret: '', fields: {} } }
    )
    const params = new URL(linked.response.url!).searchParams
    expect(params.get('client_id')).toBe('registered-client')
    expect(params.get('redirect_uri')).toBe(robinhood.redirectURI)
    const state = params.get('state')!
    const record = await internalAdapter.findVerificationValue(
      getAuthStateVerificationIdentifier(state)
    )
    expect(JSON.parse(record!.value)).toMatchObject({
      link: { userId: user.id },
      robinhoodClientId: 'registered-client',
    })
    applySetCookies(headers, linked.headers.getSetCookie())
    const response = await service.handler(
      callbackRequest('robinhood', headers, { state, error: 'access_denied' })
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      '/workspace/workspace-1/integrations?oauth_connected=robinhood&error=access_denied#node=2'
    )
  })

  it('changes the Robinhood client ID only with its replacement refresh token', async () => {
    const updateAccount = auth.options.databaseHooks!.account!.update!.before!

    await runWithSystemOAuthClientCredentials(
      async () => {
        await expect(updateAccount({ accessToken: 'new-access-token' })).resolves.toBeUndefined()
        await expect(
          updateAccount({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' })
        ).resolves.toEqual({
          data: {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            oauthClientId: 'new-client',
          },
        })
      },
      { robinhood: { clientId: 'new-client', clientSecret: '', fields: {} } }
    )
  })

  it('leaves unrelated verification records unchanged', async () => {
    const createVerification = auth.options.databaseHooks!.verification!.create!.before!

    await runWithSystemOAuthClientCredentials(
      () =>
        expect(
          createVerification(
            { value: 'not-json' } as never,
            { path: '/request-password-reset' } as never
          )
        ).resolves.toBeUndefined(),
      { robinhood: { clientId: 'registered-client', clientSecret: '', fields: {} } }
    )
  })
})

it('rejects a Tradier profile that omits the account number', async () => {
  const tradier = oauth.options.config.find((p) => p.providerId === 'tradier-live')!
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ profile: { account: {} } }))
  await expect(tradier.getUserInfo!({ accessToken: 'access-token' })).resolves.toBeNull()
})

it.each([
  { provider: 'robinhood', subject: 'user-uuid', profile: null },
  {
    provider: 'alpaca-live',
    subject: 'live-id',
    profile: { id: 'live-id', account_number: '123' },
  },
  {
    provider: 'alpaca-paper',
    subject: 'paper-id',
    profile: { id: 'paper-id', account_number: '123' },
  },
  {
    provider: 'tradier-live',
    subject: 'tradier-live:123',
    profile: { profile: { account: { account_number: '123' } } },
  },
])(
  'links and reconnects $provider only to its Studio owner',
  async ({ provider, subject, profile }) => {
    const { service, test, internalAdapter, user: owner, headers: ownerSession } = await setupLink()
    const other = await test.saveUser(test.createUser({ email: 'other@example.com' }))
    const { headers: otherSession } = await test.login({ userId: other.id })

    async function complete(accessToken: string, session?: Headers) {
      const headers = new Headers(session)
      const body = { provider, callbackURL: '/connected', errorCallbackURL: '/failed' }
      return runWithSystemOAuthClientCredentials(
        async () => {
          const start = session
            ? await service.api.linkSocialAccount({ headers, body, returnHeaders: true })
            : await service.api.signInSocial({ headers, body, returnHeaders: true })
          applySetCookies(headers, start.headers.getSetCookie())
          vi.mocked(fetch).mockResolvedValueOnce(
            Response.json({
              access_token: accessToken,
              user_uuid: ' user-uuid ',
              token_type: 'Bearer',
            })
          )
          if (profile) vi.mocked(fetch).mockResolvedValueOnce(Response.json(profile))
          const params = new URL(start.response.url!).searchParams
          expect(params.get('response_type')).toBe('code')
          const response = await service.handler(
            callbackRequest(provider, headers, {
              state: params.get('state')!,
              code: 'authorization-code',
            })
          )
          return response.headers.get('location')
        },
        { [provider]: { clientId: 'client', clientSecret: 'secret', fields: {} } }
      )
    }

    await expect(complete('initial', ownerSession)).resolves.toBe('/connected')
    await expect(complete('renewed', ownerSession)).resolves.toBe('/connected')
    await expect(complete('other', otherSession)).resolves.toBe(
      '/failed?error=account_already_linked_to_different_user'
    )
    await expect(complete('sign-in')).resolves.toBe('/failed?error=email_not_found')
    await expect(internalAdapter.findAccounts(owner.id)).resolves.toMatchObject([
      { providerId: provider, accountId: subject, accessToken: 'renewed' },
    ])
    await expect(internalAdapter.findAccounts(other.id)).resolves.toEqual([])
  }
)

it('links a Google integration using the current client and the Google UserInfo subject', async () => {
  const provider = 'google-drive'
  const { service, internalAdapter, user, headers } = await setupLink()
  await expect(
    service.api.signInSocial({ body: { provider, idToken: { token: 'id-token-only' } } })
  ).rejects.toMatchObject({ body: { code: 'ID_TOKEN_NOT_SUPPORTED' } })

  const credentials = {
    [provider]: { clientId: 'drive-client', clientSecret: 'drive-secret', fields: {} },
  }
  const linked = await runWithSystemOAuthClientCredentials(
    () =>
      service.api.linkSocialAccount({
        headers,
        body: { provider, callbackURL: '/workspace' },
        returnHeaders: true,
      }),
    credentials
  )
  const params = new URL(linked.response.url!).searchParams
  expect(params.get('client_id')).toBe('drive-client')
  expect(params.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google-drive`)
  expect(params.get('code_challenge_method')).toBe('S256')
  expect(params.get('scope')?.split(' ')).toContain('https://www.googleapis.com/auth/drive.file')
  applySetCookies(headers, linked.headers.getSetCookie())
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        access_token: 'drive-access',
        token_type: 'Bearer',
        id_token: 'unused-token',
      })
    )
    .mockResolvedValueOnce(
      Response.json({ sub: 'google-user', name: 'User', email: user.email, email_verified: true })
    )
  const response = await runWithSystemOAuthClientCredentials(
    () =>
      service.handler(
        callbackRequest(provider, headers, { state: params.get('state')!, code: 'google-code' })
      ),
    credentials
  )
  expect(response.headers.get('location')).toBe('/workspace')
  expect(fetch).toHaveBeenCalledWith('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer drive-access' },
  })
  await expect(internalAdapter.findAccounts(user.id)).resolves.toMatchObject([
    { providerId: provider, accountId: 'google-user' },
  ])
})
