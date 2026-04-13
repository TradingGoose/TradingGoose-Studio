import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveSystemIntegrationDefinitions } = vi.hoisted(() => ({
  mockResolveSystemIntegrationDefinitions: vi.fn(),
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

  it('returns no credentials when no system integration rows exist yet', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({})

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['google-email', 'github-repo'])).resolves.toEqual({})
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

  it('does not resolve env-backed social sign-in providers from the system-managed resolver', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({})

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['google', 'github'])).resolves.toEqual({})
  })
})
