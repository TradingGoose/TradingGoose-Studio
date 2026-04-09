import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

type MockOAuthCredentials = {
  clientId: string
  clientSecret: string
  fields: Record<string, string>
}

const mockCredentials: Record<string, MockOAuthCredentials> = {}

vi.mock('@/lib/oauth/system-managed-config', () => ({
  loadSystemOAuthClientCredentials: vi.fn(async (providerIds: string[]) =>
    Object.fromEntries(
      providerIds.flatMap((providerId) =>
        mockCredentials[providerId]?.clientId && mockCredentials[providerId]?.clientSecret
          ? [[providerId, mockCredentials[providerId]]]
          : []
      )
    )
  ),
  loadSystemOAuthClientCredentialsForProvider: vi.fn(async (providerId: string) =>
    mockCredentials[providerId] ?? null
  ),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

import { getOAuthProviderSubjectId, getServiceIdFromScopes } from '@/lib/oauth/oauth'
import { getOAuthProviderAvailability, refreshOAuthToken } from '@/lib/oauth/oauth.server'

function setIntegration(providerIds: string[], clientId: string, clientSecret: string) {
  for (const providerId of providerIds) {
    mockCredentials[providerId] = {
      clientId,
      clientSecret,
      fields: {
        client_id: clientId,
        client_secret: clientSecret,
      },
    }
  }
}

function seedMockIntegrations() {
  for (const key of Object.keys(mockCredentials)) {
    delete mockCredentials[key]
  }

  setIntegration(
    [
      'google-drive',
      'google-docs',
      'google-email',
      'google-sheets',
      'google-calendar',
      'google-vault',
      'google-forms',
    ],
    'google_client_id',
    'google_client_secret'
  )
  setIntegration(['github-repo'], 'github_repo_client_id', 'github_repo_client_secret')
  setIntegration(
    ['microsoft-excel', 'microsoft-teams', 'microsoft-planner', 'outlook', 'onedrive', 'sharepoint'],
    'microsoft_client_id',
    'microsoft_client_secret'
  )
  setIntegration(['x'], 'x_client_id', 'x_client_secret')
  setIntegration(['confluence'], 'confluence_client_id', 'confluence_client_secret')
  setIntegration(['jira'], 'jira_client_id', 'jira_client_secret')
  setIntegration(['airtable'], 'airtable_client_id', 'airtable_client_secret')
  setIntegration(['supabase'], 'supabase_client_id', 'supabase_client_secret')
  setIntegration(['notion'], 'notion_client_id', 'notion_client_secret')
  setIntegration(['discord'], 'discord_client_id', 'discord_client_secret')
  setIntegration(['linear'], 'linear_client_id', 'linear_client_secret')
  setIntegration(['slack'], 'slack_client_id', 'slack_client_secret')
  setIntegration(['reddit'], 'reddit_client_id', 'reddit_client_secret')
  setIntegration(['wealthbox'], 'wealthbox_client_id', 'wealthbox_client_secret')
  setIntegration(['webflow'], 'webflow_client_id', 'webflow_client_secret')
  setIntegration(['tradier'], 'tradier_client_id', 'tradier_client_secret')
  setIntegration(['alpaca'], 'alpaca_client_id', 'alpaca_client_secret')
}

describe('OAuth Provider Availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedMockIntegrations()
  })

  it('marks system-managed integration providers available', async () => {
    await expect(
      getOAuthProviderAvailability([
        'google-drive',
        'github-repo',
        'microsoft-teams',
      ])
    ).resolves.toEqual({
      'google-drive': true,
      'github-repo': true,
      'microsoft-teams': true,
    })
  })

  it('returns false when required credentials are missing', async () => {
    mockCredentials['google-email'] = {
      clientId: 'google_client_id',
      clientSecret: '',
      fields: {
        client_id: 'google_client_id',
        client_secret: '',
      },
    }
    mockCredentials['github-repo'] = {
      clientId: '',
      clientSecret: 'github_repo_client_secret',
      fields: {
        client_id: '',
        client_secret: 'github_repo_client_secret',
      },
    }

    await expect(getOAuthProviderAvailability(['google-email', 'github-repo'])).resolves.toEqual({
      'google-email': false,
      'github-repo': false,
    })
  })
})

describe('OAuth Subject Normalization', () => {
  it('prefers the service binding subject when a service id is present', () => {
    expect(
      getOAuthProviderSubjectId({
        provider: 'microsoft',
        serviceId: 'onedrive',
      })
    ).toBe('onedrive')
  })

  it('derives the service binding subject from scopes when needed', () => {
    expect(
      getOAuthProviderSubjectId({
        provider: 'google',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
      })
    ).toBe('google-email')
  })

  it('derives the microsoft teams service from base-provider scopes', () => {
    expect(
      getOAuthProviderSubjectId({
        provider: 'microsoft',
        requiredScopes: ['Chat.Read', 'offline_access'],
      })
    ).toBe('microsoft-teams')
  })

  it('normalizes plain provider declarations to the default service binding subject', () => {
    expect(
      getOAuthProviderSubjectId({
        provider: 'github',
      })
    ).toBe('github-repo')
  })

  it('keeps direct service providers stable without re-entering scope branching', () => {
    expect(getServiceIdFromScopes('google-drive', ['https://www.googleapis.com/auth/drive.file'])).toBe(
      'google-drive'
    )
  })
})

describe('OAuth Token Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedMockIntegrations()

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new_access_token',
        expires_in: 3600,
        refresh_token: 'new_refresh_token',
      }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Auth Providers', () => {
    const basicAuthProviders = [
      {
        name: 'Airtable',
        providerId: 'airtable',
        endpoint: 'https://airtable.com/oauth2/v1/token',
        expectedClientId: 'airtable_client_id',
        expectedClientSecret: 'airtable_client_secret',
      },
      {
        name: 'X (Twitter)',
        providerId: 'x',
        endpoint: 'https://api.x.com/2/oauth2/token',
        expectedClientId: 'x_client_id',
        expectedClientSecret: 'x_client_secret',
      },
      {
        name: 'Confluence',
        providerId: 'confluence',
        endpoint: 'https://auth.atlassian.com/oauth/token',
        expectedClientId: 'confluence_client_id',
        expectedClientSecret: 'confluence_client_secret',
      },
      {
        name: 'Jira',
        providerId: 'jira',
        endpoint: 'https://auth.atlassian.com/oauth/token',
        expectedClientId: 'jira_client_id',
        expectedClientSecret: 'jira_client_secret',
      },
      {
        name: 'Discord',
        providerId: 'discord',
        endpoint: 'https://discord.com/api/v10/oauth2/token',
        expectedClientId: 'discord_client_id',
        expectedClientSecret: 'discord_client_secret',
      },
      {
        name: 'Linear',
        providerId: 'linear',
        endpoint: 'https://api.linear.app/oauth/token',
        expectedClientId: 'linear_client_id',
        expectedClientSecret: 'linear_client_secret',
      },
      {
        name: 'Reddit',
        providerId: 'reddit',
        endpoint: 'https://www.reddit.com/api/v1/access_token',
        expectedClientId: 'reddit_client_id',
        expectedClientSecret: 'reddit_client_secret',
      },
    ]

    basicAuthProviders.forEach(
      ({ name, providerId, endpoint, expectedClientId, expectedClientSecret }) => {
        it(`sends ${name} refresh requests with Basic Auth and no credentials in the body`, async () => {
          const refreshToken = 'test_refresh_token'

          await refreshOAuthToken(providerId, refreshToken)

          expect(mockFetch).toHaveBeenCalledWith(
            endpoint,
            expect.objectContaining({
              method: 'POST',
              headers: expect.objectContaining({
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: expect.stringMatching(/^Basic /),
              }),
              body: expect.any(String),
            })
          )

          const [, requestOptions] = (mockFetch as Mock).mock.calls[0]
          const authHeader = requestOptions.headers.Authorization
          const base64Credentials = authHeader.replace('Basic ', '')
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
          const [clientId, clientSecret] = credentials.split(':')

          expect(clientId).toBe(expectedClientId)
          expect(clientSecret).toBe(expectedClientSecret)

          const bodyParams = new URLSearchParams(requestOptions.body)
          const bodyKeys = Array.from(bodyParams.keys())

          expect(bodyKeys).toEqual(['grant_type', 'refresh_token'])
          expect(bodyParams.get('grant_type')).toBe('refresh_token')
          expect(bodyParams.get('refresh_token')).toBe(refreshToken)
          expect(bodyParams.get('client_id')).toBeNull()
          expect(bodyParams.get('client_secret')).toBeNull()
        })
      }
    )
  })

  describe('Body Credential Providers', () => {
    const bodyCredentialProviders = [
      {
        name: 'Google Email',
        providerId: 'google-email',
        endpoint: 'https://oauth2.googleapis.com/token',
        expectedClientId: 'google_client_id',
        expectedClientSecret: 'google_client_secret',
      },
      {
        name: 'GitHub Repo',
        providerId: 'github-repo',
        endpoint: 'https://github.com/login/oauth/access_token',
        expectedClientId: 'github_repo_client_id',
        expectedClientSecret: 'github_repo_client_secret',
      },
      {
        name: 'Microsoft Teams',
        providerId: 'microsoft-teams',
        endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        expectedClientId: 'microsoft_client_id',
        expectedClientSecret: 'microsoft_client_secret',
      },
      {
        name: 'Outlook',
        providerId: 'outlook',
        endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        expectedClientId: 'microsoft_client_id',
        expectedClientSecret: 'microsoft_client_secret',
      },
      {
        name: 'Supabase',
        providerId: 'supabase',
        endpoint: 'https://api.supabase.com/v1/oauth/token',
        expectedClientId: 'supabase_client_id',
        expectedClientSecret: 'supabase_client_secret',
      },
      {
        name: 'Slack',
        providerId: 'slack',
        endpoint: 'https://slack.com/api/oauth.v2.access',
        expectedClientId: 'slack_client_id',
        expectedClientSecret: 'slack_client_secret',
      },
      {
        name: 'Tradier',
        providerId: 'tradier',
        endpoint: 'https://api.tradier.com/v1/oauth/token',
        expectedClientId: 'tradier_client_id',
        expectedClientSecret: 'tradier_client_secret',
      },
      {
        name: 'Alpaca',
        providerId: 'alpaca',
        endpoint: 'https://api.alpaca.markets/oauth/token',
        expectedClientId: 'alpaca_client_id',
        expectedClientSecret: 'alpaca_client_secret',
      },
    ]

    bodyCredentialProviders.forEach(
      ({ name, providerId, endpoint, expectedClientId, expectedClientSecret }) => {
        it(`sends ${name} refresh requests with credentials in the body`, async () => {
          const refreshToken = 'test_refresh_token'

          await refreshOAuthToken(providerId, refreshToken)

          expect(mockFetch).toHaveBeenCalledWith(
            endpoint,
            expect.objectContaining({
              method: 'POST',
              headers: expect.objectContaining({
                'Content-Type': 'application/x-www-form-urlencoded',
              }),
              body: expect.any(String),
            })
          )

          const [, requestOptions] = (mockFetch as Mock).mock.calls[0]
          expect(requestOptions.headers.Authorization).toBeUndefined()

          const bodyParams = new URLSearchParams(requestOptions.body)
          const bodyKeys = Array.from(bodyParams.keys()).sort()

          expect(bodyKeys).toEqual(['client_id', 'client_secret', 'grant_type', 'refresh_token'])
          expect(bodyParams.get('grant_type')).toBe('refresh_token')
          expect(bodyParams.get('refresh_token')).toBe(refreshToken)
          expect(bodyParams.get('client_id')).toBe(expectedClientId)
          expect(bodyParams.get('client_secret')).toBe(expectedClientSecret)
        })
      }
    )

    it('includes Accept header for GitHub requests', async () => {
      await refreshOAuthToken('github-repo', 'test_refresh_token')

      const [, requestOptions] = (mockFetch as Mock).mock.calls[0]
      expect(requestOptions.headers.Accept).toBe('application/json')
    })

    it('sends Notion refresh requests as JSON with Basic Auth', async () => {
      const refreshToken = 'test_refresh_token'

      await refreshOAuthToken('notion', refreshToken)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringMatching(/^Basic /),
          }),
          body: expect.any(String),
        })
      )

      const [, requestOptions] = (mockFetch as Mock).mock.calls[0]
      const body = JSON.parse(requestOptions.body)

      expect(body).toEqual({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    })
  })

  describe('Error Handling', () => {
    it('returns null for unsupported provider', async () => {
      await expect(refreshOAuthToken('unsupported', 'test_refresh_token')).resolves.toBeNull()
    })

    it('returns null when the provider is missing credentials', async () => {
      mockCredentials['google-email'] = {
        clientId: '',
        clientSecret: 'google_client_secret',
        fields: {
          client_id: '',
          client_secret: 'google_client_secret',
        },
      }

      await expect(refreshOAuthToken('google-email', 'test_refresh_token')).resolves.toBeNull()
    })

    it('returns null for API error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'Invalid refresh token',
          }),
      })

      await expect(refreshOAuthToken('google-email', 'test_refresh_token')).resolves.toBeNull()
    })

    it('returns null for network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(refreshOAuthToken('google-email', 'test_refresh_token')).resolves.toBeNull()
    })
  })

  describe('Token Response Handling', () => {
    it('handles providers that return new refresh tokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          refresh_token: 'new_refresh_token',
        }),
      })

      await expect(refreshOAuthToken('airtable', 'old_refresh_token')).resolves.toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: 'new_refresh_token',
      })
    })

    it('uses the original refresh token when a new one is not provided', async () => {
      const refreshToken = 'original_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
        }),
      })

      await expect(refreshOAuthToken('google-email', refreshToken)).resolves.toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken,
      })
    })

    it('returns null when the access token is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          expires_in: 3600,
        }),
      })

      await expect(refreshOAuthToken('google-email', 'test_refresh_token')).resolves.toBeNull()
    })

    it('uses the default expiration when not provided', async () => {
      const refreshToken = 'test_refresh_token'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
        }),
      })

      await expect(refreshOAuthToken('google-email', refreshToken)).resolves.toEqual({
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken,
      })
    })
  })
})
