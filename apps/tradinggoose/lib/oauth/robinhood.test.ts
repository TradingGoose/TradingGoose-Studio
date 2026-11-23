import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerClient } = vi.hoisted(() => ({ registerClient: vi.fn() }))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ registerClient }))

import { registerRobinhoodOAuthClient } from './robinhood'
import {
  getRobinhoodOAuthRedirectUri,
  ROBINHOOD_LOOPBACK_REDIRECT_URI,
} from './robinhood-constants'

describe('Robinhood OAuth registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerClient.mockImplementation(async (_resource, { clientMetadata }) => ({
      ...clientMetadata,
      client_id: 'registered-client',
    }))
  })

  it.each([
    [ROBINHOOD_LOOPBACK_REDIRECT_URI, 'native'],
    ['http://localhost:3000/api/auth/callback/robinhood', 'native'],
    ['https://studio.example.com/api/auth/callback/robinhood', 'web'],
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

  it.each([
    [false, 'http://localhost:3000/api/auth/callback/robinhood'],
    [true, ROBINHOOD_LOOPBACK_REDIRECT_URI],
  ])('selects the canonical callback when hosted is %s', (hosted, expected) => {
    expect(getRobinhoodOAuthRedirectUri('http://localhost:3000', hosted)).toBe(expected)
  })
})
