import { betterAuth, getAuthStateVerificationIdentifier } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { getOAuthState } from 'better-auth/api'
import { applySetCookies } from 'better-auth/cookies'
import { genericOAuth, testUtils } from 'better-auth/plugins'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerClient } = vi.hoisted(() => ({ registerClient: vi.fn() }))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))
vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('better-auth/api', async (original) => {
  const actual = await original<typeof import('better-auth/api')>()
  return { ...actual, getOAuthState: vi.fn() }
})
vi.mock('better-auth/plugins', async (original) => {
  const actual = await original<typeof import('better-auth/plugins')>()
  return { ...actual, genericOAuth: vi.fn(actual.genericOAuth) }
})

import { auth } from './auth'
import { isHosted } from './environment'
import { getRobinhoodOAuthRedirectUri } from './oauth/robinhood-constants'
import { runWithSystemOAuthClientCredentials } from './oauth/system-managed-config'
import { getBaseUrl } from './urls/utils'

const config = vi
  .mocked(genericOAuth)
  .mock.calls[0][0].config.find((provider) => provider.providerId === 'robinhood')!

describe('Robinhood OAuth identity', () => {
  beforeEach(() => {
    vi.mocked(getOAuthState).mockResolvedValue({
      link: { userId: 'studio-user', email: 'user@example.com' },
    } as Awaited<ReturnType<typeof getOAuthState>>)
  })

  it('uses the token user UUID as the stable account identity', async () => {
    const tokens = {
      accessToken: 'access-token',
      raw: { user_uuid: ' user-uuid ' },
    }
    const profile = await config.getUserInfo!(tokens)

    expect(profile).toMatchObject({ id: 'user-uuid', name: 'Robinhood' })
  })

  it('rejects token responses without a stable user identity', async () => {
    await expect(config.getUserInfo!({ accessToken: 'access-token', raw: {} })).rejects.toThrow(
      'missing the user identity'
    )
  })

  it('rejects callbacks without an authenticated link state', async () => {
    vi.mocked(getOAuthState).mockResolvedValueOnce(null)

    await expect(
      config.getUserInfo!({ accessToken: 'access-token', raw: { user_uuid: 'user-uuid' } })
    ).rejects.toThrow('requires an authenticated link')
  })
})

describe('Robinhood OAuth linking', () => {
  beforeEach(() => {
    registerClient.mockReset()
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
  })

  it('uses the environment callback for authorization and token exchange', () => {
    expect(config.redirectURI).toBe(getRobinhoodOAuthRedirectUri(getBaseUrl(), isHosted))
  })

  it('registers the client after authentication and returns consent errors to the saved destination', async () => {
    const baseURL = 'http://localhost:3000'
    const service = betterAuth({
      baseURL,
      secret: 'robinhood-test-secret-that-is-long-enough',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      databaseHooks: { verification: auth.options.databaseHooks.verification },
      plugins: [genericOAuth({ config: [config] }), testUtils()],
    })
    const { test, internalAdapter } = await service.$context
    const user = await test.saveUser(test.createUser({ email: 'user@example.com' }))
    const { headers } = await test.login({ userId: user.id })
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
    expect(params.get('redirect_uri')).toBe(config.redirectURI)
    const state = params.get('state')!
    const record = await internalAdapter.findVerificationValue(
      getAuthStateVerificationIdentifier(state)
    )
    expect(JSON.parse(record!.value)).toMatchObject({
      link: { userId: user.id },
      robinhoodClientId: 'registered-client',
    })
    applySetCookies(headers, linked.headers.getSetCookie())
    const callback = new URL('/api/auth/callback/robinhood', baseURL)
    callback.search = new URLSearchParams({ state, error: 'access_denied' }).toString()
    const response = await service.handler(new Request(callback, { headers }))
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

it('links a Google integration using the current client and the Google UserInfo subject', async () => {
  const provider = 'google-drive'
  const google = vi
    .mocked(genericOAuth)
    .mock.calls[0][0].config.find((c) => c.providerId === provider)!
  const baseURL = 'http://localhost:3000'
  const service = betterAuth({
    baseURL,
    secret: 'google-link-test-secret-that-is-long-enough',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    plugins: [genericOAuth({ config: [google] }), testUtils()],
  })
  const { test, internalAdapter } = await service.$context
  const user = await test.saveUser(test.createUser({ email: 'user@example.com' }))
  const { headers } = await test.login({ userId: user.id })
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
  const callback = new URL('/api/auth/callback/google-drive', baseURL)
  callback.search = new URLSearchParams({
    state: params.get('state')!,
    code: 'google-code',
  }).toString()
  const response = await runWithSystemOAuthClientCredentials(
    () => service.handler(new Request(callback, { headers })),
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
