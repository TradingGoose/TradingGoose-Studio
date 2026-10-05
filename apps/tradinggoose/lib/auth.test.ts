import { getOAuthState } from 'better-auth/api'
import { genericOAuth } from 'better-auth/plugins'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import './auth'

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
