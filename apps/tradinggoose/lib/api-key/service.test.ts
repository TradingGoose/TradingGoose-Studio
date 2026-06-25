/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
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
}))

vi.mock('@/lib/env', () => ({ env: {} }))
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
      where: vi.fn().mockResolvedValue(rows),
    })),
  })
}

describe('API key service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
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
})
