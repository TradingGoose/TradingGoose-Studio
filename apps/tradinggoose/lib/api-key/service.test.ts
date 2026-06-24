/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticateApiKeyMock, fromMock, selectMock, whereMock } = vi.hoisted(() => ({
  authenticateApiKeyMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
  whereMock: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: selectMock,
  },
}))

vi.mock('@/lib/api-key/auth', () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}))

import {
  authenticateApiKeyFromHeader,
  generateApiKey,
  generateEncryptedApiKey,
} from '@/lib/api-key/service'

describe('authenticateApiKeyFromHeader', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    selectMock.mockReturnValue({ from: fromMock })
    fromMock.mockReturnValue({ where: whereMock })
  })

  it('rejects malformed keys before querying stored keys', async () => {
    await expect(
      authenticateApiKeyFromHeader('sk-tradinggoose-malformed', { keyTypes: ['personal'] })
    ).resolves.toEqual({ success: false, error: 'Invalid API key' })

    expect(selectMock).not.toHaveBeenCalled()
    expect(authenticateApiKeyMock).not.toHaveBeenCalled()
  })

  it('authenticates staging-format personal API keys', async () => {
    const token = `sk-tradinggoose-${'a'.repeat(32)}`
    whereMock.mockResolvedValue([
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        key: 'stored-key',
        expiresAt: null,
      },
    ])
    authenticateApiKeyMock.mockResolvedValue(true)

    await expect(
      authenticateApiKeyFromHeader(token, { keyTypes: ['personal'] })
    ).resolves.toEqual({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
      keyType: 'personal',
      workspaceId: undefined,
    })

    expect(whereMock).toHaveBeenCalledOnce()
    expect(authenticateApiKeyMock).toHaveBeenCalledWith(token, 'stored-key')
  })

  it('generates staging-format API keys without embedded database ids', () => {
    expect(generateApiKey()).toMatch(/^tradinggoose_[A-Za-z0-9_-]{32}$/)
    expect(generateEncryptedApiKey()).toMatch(/^sk-tradinggoose-[A-Za-z0-9_-]{32}$/)
  })
})
