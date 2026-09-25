import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveSystemIntegrationDefinitions } = vi.hoisted(() => ({
  mockResolveSystemIntegrationDefinitions: vi.fn(),
}))

const registration = vi.hoisted(() => ({
  register: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  registerClient: registration.register,
}))

vi.mock('@tradinggoose/db', () => ({
  db: { transaction: registration.transaction },
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: async (value: string) => ({ decrypted: value.replace(/^encrypted:/, '') }),
  encryptSecret: async (value: string) => ({ encrypted: `encrypted:${value}` }),
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

    await expect(
      loadSystemOAuthClientCredentials(['google-email', 'github-repo'])
    ).resolves.toEqual({})
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

  it('supports Trello API-key-only system credentials', async () => {
    mockResolveSystemIntegrationDefinitions.mockResolvedValue({
      trello: {
        isEnabled: true,
        secrets: {
          api_key: 'trello-api-key',
        },
      },
    })

    const { loadSystemOAuthClientCredentials } = await import('./system-managed-config')

    await expect(loadSystemOAuthClientCredentials(['trello'])).resolves.toEqual({
      trello: {
        clientId: 'trello-api-key',
        clientSecret: '',
        fields: {
          api_key: 'trello-api-key',
        },
      },
    })
  })

  it('rejects a redirect URI change without replacing the Robinhood registration', async () => {
    const lock = vi.fn()
    const values = vi.fn(() => ({ onConflictDoNothing: vi.fn(), onConflictDoUpdate: vi.fn() }))
    const where = vi
      .fn()
      .mockReturnValueOnce({ for: lock })
      .mockReturnValueOnce([
        { key: 'client_id', value: 'encrypted:existing-client' },
        { key: 'redirect_uri', value: 'encrypted:https://old.example/callback' },
      ])
    const tx = {
      insert: () => ({ values }),
      select: () => ({ from: () => ({ where }) }),
    }
    registration.transaction.mockImplementation((callback: (store: typeof tx) => unknown) =>
      callback(tx)
    )
    const { ensureRobinhoodOAuthClient } = await import('./system-managed-config')

    await expect(ensureRobinhoodOAuthClient('https://studio.example/callback')).rejects.toThrow(
      'Robinhood OAuth client is registered for a different redirect URI'
    )

    expect(lock).toHaveBeenCalledOnce()
    expect(registration.register).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledOnce()
  })
})
