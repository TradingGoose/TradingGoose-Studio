/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, limitMock, selectMock, whereMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  limitMock: vi.fn(),
  selectMock: vi.fn(),
  whereMock: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: selectMock,
  },
}))

import {
  authenticateApiKeyFromHeader,
  generateApiKey,
  getApiKeyDisplayFormat,
  getStoredApiKey,
} from '@/lib/api-key/service'

describe('authenticateApiKeyFromHeader', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    selectMock.mockReturnValue({ from: fromMock })
    fromMock.mockReturnValue({ where: whereMock })
    whereMock.mockReturnValue({ limit: limitMock })
  })

  it('rejects malformed keys before querying stored keys', async () => {
    await expect(
      authenticateApiKeyFromHeader('sk-tradinggoose-malformed', { keyTypes: ['personal'] })
    ).resolves.toEqual({ success: false, error: 'Invalid API key' })

    expect(selectMock).not.toHaveBeenCalled()
  })

  it('authenticates personal API keys by stored-key lookup', async () => {
    const token = `sk-tradinggoose-${'a'.repeat(32)}`
    limitMock.mockResolvedValue([
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: null,
      },
    ])

    await expect(authenticateApiKeyFromHeader(token, { keyTypes: ['personal'] })).resolves.toEqual({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
      keyType: 'personal',
      workspaceId: undefined,
    })

    expect(whereMock).toHaveBeenCalledOnce()
    expect(limitMock).toHaveBeenCalledWith(1)
  })

  it('rejects unknown well-formed keys after one exact lookup', async () => {
    const token = `sk-tradinggoose-${'b'.repeat(32)}`
    limitMock.mockResolvedValue([])

    await expect(authenticateApiKeyFromHeader(token, { keyTypes: ['personal'] })).resolves.toEqual({
      success: false,
      error: 'Invalid API key',
    })

    expect(whereMock).toHaveBeenCalledOnce()
    expect(limitMock).toHaveBeenCalledWith(1)
  })

  it('stores API keys as non-reversible display plus digest values', () => {
    const key = generateApiKey()
    const storedKey = getStoredApiKey(key)

    expect(key).toMatch(/^sk-tradinggoose-[A-Za-z0-9_-]{32}$/)
    expect(storedKey).toContain(':sha256:')
    expect(storedKey).not.toContain(key)
    expect(getApiKeyDisplayFormat(storedKey)).toMatch(/^sk-tradinggoose-\.\.\.[A-Za-z0-9_-]{4}$/)
  })
})
