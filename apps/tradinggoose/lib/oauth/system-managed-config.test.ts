import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveSystemIntegrationDefinitions } = vi.hoisted(() => ({
  mockResolveSystemIntegrationDefinitions: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  getEnv: (key: string) =>
    (
      ({
        GOOGLE_CLIENT_ID: 'google-env-client-id',
        GOOGLE_CLIENT_SECRET: 'google-env-client-secret',
        GITHUB_REPO_CLIENT_ID: 'github-env-client-id',
        GITHUB_REPO_CLIENT_SECRET: 'github-env-client-secret',
      }) as Record<string, string>
    )[key],
}))

vi.mock('@/lib/system-integrations/resolver', () => ({
  resolveSystemIntegrationDefinitions: (...args: unknown[]) =>
    mockResolveSystemIntegrationDefinitions(...args),
}))

describe('system managed oauth client credentials', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('falls back to env-backed credentials when no system integration rows exist yet', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({})

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(
      loadSystemOAuthClientCredentials(['google-email', 'github-repo'])
    ).resolves.toEqual({
      'google-email': {
        clientId: 'google-env-client-id',
        clientSecret: 'google-env-client-secret',
        fields: {
          client_id: 'google-env-client-id',
          client_secret: 'google-env-client-secret',
        },
      },
      'github-repo': {
        clientId: 'github-env-client-id',
        clientSecret: 'github-env-client-secret',
        fields: {
          client_id: 'github-env-client-id',
          client_secret: 'github-env-client-secret',
        },
      },
    })
  })

  it('maps social sign-in providers to their system-managed credential subjects', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({
      'google-email': {
        isEnabled: true,
        secrets: {
          client_id: 'google-db-client-id',
          client_secret: 'google-db-client-secret',
        },
      },
      'github-repo': {
        isEnabled: true,
        secrets: {
          client_id: 'github-db-client-id',
          client_secret: 'github-db-client-secret',
        },
      },
    })

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['google', 'github'])).resolves.toEqual({
      google: {
        clientId: 'google-db-client-id',
        clientSecret: 'google-db-client-secret',
        fields: {
          client_id: 'google-db-client-id',
          client_secret: 'google-db-client-secret',
        },
      },
      github: {
        clientId: 'github-db-client-id',
        clientSecret: 'github-db-client-secret',
        fields: {
          client_id: 'github-db-client-id',
          client_secret: 'github-db-client-secret',
        },
      },
    })
  })

  it('prefers system-managed credentials when the provider is present in the catalog', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({
      'google-email': {
        isEnabled: true,
        secrets: {
          client_id: 'google-db-client-id',
          client_secret: 'google-db-client-secret',
        },
      },
    })

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['google-email'])).resolves.toEqual({
      'google-email': {
        clientId: 'google-db-client-id',
        clientSecret: 'google-db-client-secret',
        fields: {
          client_id: 'google-db-client-id',
          client_secret: 'google-db-client-secret',
        },
      },
    })
  })

  it('does not fall back to env credentials once a provider exists but is disabled or incomplete', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({
      'google-email': {
        isEnabled: false,
        secrets: {
          client_id: 'google-db-client-id',
          client_secret: '',
        },
      },
    })

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['google-email'])).resolves.toEqual({})
  })

  it('reuses subject env fallbacks for social sign-in providers when no database rows exist yet', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({})

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['google', 'github'])).resolves.toEqual({
      google: {
        clientId: 'google-env-client-id',
        clientSecret: 'google-env-client-secret',
        fields: {
          client_id: 'google-env-client-id',
          client_secret: 'google-env-client-secret',
        },
      },
      github: {
        clientId: 'github-env-client-id',
        clientSecret: 'github-env-client-secret',
        fields: {
          client_id: 'github-env-client-id',
          client_secret: 'github-env-client-secret',
        },
      },
    })
  })
})
