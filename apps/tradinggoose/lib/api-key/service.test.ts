/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockEnv } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockEnv: { API_ENCRYPTION_KEY: 'a'.repeat(64) } as { API_ENCRYPTION_KEY?: string },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  apiKey: {
    id: 'apiKey.id',
    userId: 'apiKey.userId',
    workspaceId: 'apiKey.workspaceId',
    type: 'apiKey.type',
    key: 'apiKey.key',
    expiresAt: 'apiKey.expiresAt',
    lastUsed: 'apiKey.lastUsed',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((field, value) => ({ field, value })),
  inArray: vi.fn((field, values) => ({ field, values })),
  like: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/env', () => ({ env: mockEnv }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function mockApiKeyRows(rows: unknown[]) {
  mockDbSelect.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  })
}

describe('API key service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockEnv.API_ENCRYPTION_KEY = 'a'.repeat(64)
    mockApiKeyRows([])
  })

  it('rejects malformed API keys before reading key records', async () => {
    const { authenticateApiKeyFromHeader } = await import('./service')

    await expect(authenticateApiKeyFromHeader('not-a-generated-key')).resolves.toMatchObject({
      success: false,
      error: 'Invalid API key',
    })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('disables API-key authentication when encrypted storage is not configured', async () => {
    mockEnv.API_ENCRYPTION_KEY = undefined
    const { authenticateApiKeyFromHeader, storedApiKeyMatches } = await import('./service')

    await expect(
      authenticateApiKeyFromHeader(`sk-tradinggoose-${'a'.repeat(32)}`)
    ).resolves.toMatchObject({
      success: false,
      error: 'API key access is not configured',
    })
    await expect(
      storedApiKeyMatches(
        `sk-tradinggoose-${'a'.repeat(32)}`,
        'sk-tradinggoose-...aaaa:'.concat('b'.repeat(64), ':iv:encrypted:tag')
      )
    ).resolves.toBe(false)
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('rejects retired plaintext API-key prefixes before reading key records', async () => {
    const { authenticateApiKeyFromHeader } = await import('./service')

    await expect(
      authenticateApiKeyFromHeader(`tradinggoose_${'a'.repeat(32)}`)
    ).resolves.toMatchObject({
      success: false,
      error: 'Invalid API key',
    })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('looks up the stored key by stable encrypted-storage prefix and scopes by key type', async () => {
    const { authenticateApiKeyFromHeader, getStoredApiKey } = await import('./service')
    const { eq, inArray, like } = await import('drizzle-orm')

    const apiKey = `sk-tradinggoose-${'a'.repeat(32)}`
    await authenticateApiKeyFromHeader(apiKey)
    const [displayKey, lookupDigest] = getStoredApiKey(apiKey).split(':')
    expect(like).toHaveBeenCalledWith('apiKey.key', `${displayKey}:${lookupDigest}:%`)
    expect(inArray).toHaveBeenCalledWith('apiKey.type', ['personal', 'workspace'])

    await authenticateApiKeyFromHeader(apiKey, { keyTypes: ['personal'] })
    expect(eq).toHaveBeenCalledWith('apiKey.type', 'personal')
  })

  it('stores encrypted API keys with stable lookup prefixes', async () => {
    const { getStoredApiKey, storedApiKeyMatches } = await import('./service')
    const apiKey = `sk-tradinggoose-${'b'.repeat(32)}`
    const firstStoredKey = getStoredApiKey(apiKey)
    const secondStoredKey = getStoredApiKey(apiKey)

    expect(firstStoredKey).not.toBe(secondStoredKey)
    expect(firstStoredKey.split(':').slice(0, 2)).toEqual(secondStoredKey.split(':').slice(0, 2))
    await expect(storedApiKeyMatches(apiKey, firstStoredKey)).resolves.toBe(true)
  })

  it('rejects retired stored API-key formats without fallback decryption', async () => {
    const { getApiKeyDisplayFormat, storedApiKeyMatches } = await import('./service')

    await expect(
      storedApiKeyMatches(`sk-tradinggoose-${'b'.repeat(32)}`, 'iv:ciphertext:authTag')
    ).resolves.toBe(false)
    expect(getApiKeyDisplayFormat('iv:ciphertext:authTag')).toBeNull()
  })
})
