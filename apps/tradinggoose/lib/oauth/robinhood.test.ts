import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerClient = vi.hoisted(() => vi.fn())

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))
vi.mock('@tradinggoose/db', () => ({ db: {}, verification: {} }))

import { addRobinhoodOAuthClientToState, registerRobinhoodOAuthClient } from './robinhood'

describe('Robinhood OAuth registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
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

  it('stores the registration in the existing OAuth state payload', () => {
    expect(
      JSON.parse(addRobinhoodOAuthClientToState('{"oauthState":"state"}', 'registered-client'))
    ).toEqual({ oauthState: 'state', robinhoodClientId: 'registered-client' })
  })
})
