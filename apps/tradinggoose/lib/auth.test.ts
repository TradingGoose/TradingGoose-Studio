import { genericOAuth } from 'better-auth/plugins'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('better-auth/plugins', async (original) => {
  const actual = await original<typeof import('better-auth/plugins')>()
  return { ...actual, genericOAuth: vi.fn(actual.genericOAuth) }
})

import './auth'

const config = vi
  .mocked(genericOAuth)
  .mock.calls[0][0].config.find((provider) => provider.providerId === 'robinhood')!

describe('Robinhood OAuth identity', () => {
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
})
