import { beforeEach, describe, expect, it, vi } from 'vitest'

const { limit, registerClient } = vi.hoisted(() => ({ limit: vi.fn(), registerClient: vi.fn() }))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
  verification: { identifier: 'identifier', value: 'value' },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

import {
  addRobinhoodOAuthClientToState,
  getRobinhoodOAuthClientIdFromState,
  registerRobinhoodOAuthClient,
} from './robinhood'

describe('Robinhood OAuth registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
    limit.mockResolvedValue([])
  })

  it.each([
    ['http://localhost:3000/api/auth/oauth2/callback/robinhood', 'native'],
    ['https://www.tradinggoose.ai/api/auth/oauth2/callback/robinhood', 'web'],
  ] as const)('registers %s as a %s public client', async (redirectUri, applicationType) => {
    await expect(registerRobinhoodOAuthClient(redirectUri)).resolves.toBe('registered-client')

    expect(registerClient).toHaveBeenCalledWith(
      'https://agent.robinhood.com/mcp/trading',
      expect.objectContaining({
        clientMetadata: expect.objectContaining({
          application_type: applicationType,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
        }),
      })
    )
  })

  it('binds the registration to an authenticated link state', () => {
    expect(
      JSON.parse(
        addRobinhoodOAuthClientToState('{"link":{"userId":"user-1"}}', 'registered-client')
      )
    ).toEqual({ link: { userId: 'user-1' }, robinhoodClientId: 'registered-client' })
  })

  it('rejects registering a client without an authenticated link state', () => {
    expect(() =>
      addRobinhoodOAuthClientToState('{"oauthState":"state"}', 'registered-client')
    ).toThrow('requires an authenticated link')
  })

  it('loads registrations only from authenticated link states', async () => {
    limit
      .mockResolvedValueOnce([
        { value: '{"link":{"userId":"user-1"},"robinhoodClientId":"registered-client"}' },
      ])
      .mockResolvedValueOnce([{ value: '{"robinhoodClientId":"forged-client"}' }])

    await expect(getRobinhoodOAuthClientIdFromState('linked-state')).resolves.toBe(
      'registered-client'
    )
    await expect(getRobinhoodOAuthClientIdFromState('unlinked-state')).resolves.toBe('')
  })
})
