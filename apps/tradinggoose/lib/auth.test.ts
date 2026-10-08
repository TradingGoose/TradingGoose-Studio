import { getOAuthState } from 'better-auth/api'
import { genericOAuth } from 'better-auth/plugins'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerClient } = vi.hoisted(() => ({ registerClient: vi.fn() }))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))
vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('better-auth', async (original) => {
  const actual = await original<typeof import('better-auth')>()
  return { ...actual, parseState: vi.fn(actual.parseState) }
})
vi.mock('better-auth/api', async (original) => {
  const actual = await original<typeof import('better-auth/api')>()
  return { ...actual, getOAuthState: vi.fn() }
})
vi.mock('better-auth/plugins', async (original) => {
  const actual = await original<typeof import('better-auth/plugins')>()
  return { ...actual, genericOAuth: vi.fn(actual.genericOAuth) }
})

import { parseState } from 'better-auth'
import { auth } from './auth'
import { isHosted } from './environment'
import { getRobinhoodOAuthRedirectUri } from './oauth/robinhood-constants'
import {
  getSystemOAuthClientCredentialsForRequest,
  runWithSystemOAuthClientCredentials,
} from './oauth/system-managed-config'
import { getBaseUrl } from './urls/utils'

const genericOAuthPlugin = vi.mocked(genericOAuth).mock.results[0].value!
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
    vi.mocked(parseState).mockReset()
    registerClient.mockReset()
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
  })

  it('uses the environment callback for authorization and token exchange', () => {
    expect(config.redirectURI).toBe(getRobinhoodOAuthRedirectUri(getBaseUrl(), isHosted))
  })

  it('returns Robinhood consent errors to the saved integration callback', async () => {
    vi.mocked(parseState).mockResolvedValue({
      callbackURL: '/workspace/workspace-1/integrations?oauth_connected=robinhood',
      codeVerifier: 'verifier',
      errorURL: '/workspace/workspace-1/integrations?oauth_connected=robinhood',
      expiresAt: Date.now() + 60_000,
    })

    const response = await auth.handler(
      new Request(
        'http://localhost:3000/api/auth/oauth2/callback/robinhood?error=access_denied&error_description=User+denied+access&state=state'
      )
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      '/workspace/workspace-1/integrations?oauth_connected=robinhood&error=access_denied&error_description=User+denied+access'
    )
  })

  it('keeps invalid Robinhood callback state on the auth error path', async () => {
    vi.mocked(parseState).mockImplementationOnce(async (ctx) => {
      throw ctx.redirect('/error?error=state_mismatch')
    })

    const response = await auth.handler(
      new Request(
        'http://localhost:3000/api/auth/oauth2/callback/robinhood?error=access_denied&state=invalid'
      )
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/error?error=state_mismatch')
  })

  it('validates link requests before registering a client', async () => {
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/oauth2/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'robinhood' }),
      })
    )

    expect(response.status).toBe(400)
    expect(registerClient).not.toHaveBeenCalled()
  })

  it('installs a registered client in the validated link request scope', async () => {
    const registerClientForLink = genericOAuthPlugin.endpoints.oAuth2LinkAccount.options.use.at(-1)!

    await runWithSystemOAuthClientCredentials(
      async () => {
        await registerClientForLink({
          body: { providerId: 'robinhood' },
          context: { session: { session: {}, user: {} } },
        } as never)
        expect(getSystemOAuthClientCredentialsForRequest('robinhood').clientId).toBe(
          'registered-client'
        )
        expect(registerClient).toHaveBeenCalledWith(
          'https://agent.robinhood.com/mcp/trading',
          expect.objectContaining({
            clientMetadata: expect.objectContaining({ redirect_uris: [config.redirectURI] }),
          })
        )
      },
      { robinhood: { clientId: '', clientSecret: '', fields: {} } }
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
