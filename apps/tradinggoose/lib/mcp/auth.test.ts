/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { db, mockCreateApiKey, mockEncryptApiKeyForStorage, mockIsApiKeyFormat } = vi.hoisted(
  () => ({
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn(),
    },
    mockCreateApiKey: vi.fn(),
    mockEncryptApiKeyForStorage: vi.fn(),
    mockIsApiKeyFormat: vi.fn(),
  })
)

const verification = Object.fromEntries(
  ['id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt'].map((field) => [
    field,
    `verification.${field}`,
  ])
)

vi.mock('@tradinggoose/db', () => ({ db }))
vi.mock('@tradinggoose/db/schema', () => ({ apiKey: {}, verification }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((field, value) => ({ field, value })),
  like: vi.fn((field, value) => ({ field, value })),
  lte: vi.fn((field, value) => ({ field, value })),
}))
vi.mock('@/lib/api-key/service', () => ({
  createApiKey: mockCreateApiKey,
  encryptApiKeyForStorage: mockEncryptApiKeyForStorage,
  isApiKeyFormat: mockIsApiKeyFormat,
}))
vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: '12345678901234567890123456789012' } }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: vi.fn(() => 'https://studio.example.test') }))

function selectRows(...responses: unknown[][]) {
  db.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(responses.shift() ?? []),
      })),
    })),
  }))
}

function mockDelete() {
  db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
}

function mockInsertValues() {
  const values = vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }))
  db.insert.mockReturnValue({ values })
  return values
}

function readCodeFields(code: string) {
  const [, createdAt, expiresAt, , verificationKeyHash] = code.split('.')
  return {
    createdAt: new Date(Number(createdAt)).toISOString(),
    expiresAt: new Date(Number(expiresAt)),
    verificationKeyHash,
  }
}

describe('MCP device login auth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T12:00:00.000Z'))
    vi.clearAllMocks()
    mockCreateApiKey.mockResolvedValue({ key: `sk-tradinggoose-${'a'.repeat(32)}` })
    mockEncryptApiKeyForStorage.mockResolvedValue('encrypted-api-key')
    mockIsApiKeyFormat.mockReturnValue(true)
    mockDelete()
    selectRows()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('materializes pending state with the signed expiry from the approval flow', async () => {
    const { createMcpDeviceLoginApprovalChallenge, startMcpDeviceLogin } = await import('./auth')
    const login = await startMcpDeviceLogin()
    expect(login.code).toBeTruthy()
    expect(login.verificationKey).toBeTruthy()
    expect(login.expiresAt).toBe('2026-06-19T12:10:00.000Z')
    expect(db.insert).not.toHaveBeenCalled()

    const fields = readCodeFields(login.code)
    selectRows(
      [],
      [
        {
          id: 'device-login-row',
          value: JSON.stringify({
            status: 'pending',
            createdAt: fields.createdAt,
            verificationKeyHash: fields.verificationKeyHash,
          }),
          expiresAt: fields.expiresAt,
        },
      ]
    )
    const insertValues = mockInsertValues()

    const challenge = await createMcpDeviceLoginApprovalChallenge({
      code: login.code,
      userId: 'user-1',
    })

    expect(challenge.status).toBe('pending')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: fields.expiresAt,
      })
    )
  })

  it('deletes the row for a signed code revisited after expiry', async () => {
    const { pollMcpDeviceLogin, startMcpDeviceLogin } = await import('./auth')
    const login = await startMcpDeviceLogin()
    vi.setSystemTime(new Date('2026-06-19T12:11:00.000Z'))

    await expect(pollMcpDeviceLogin(login.code, login.verificationKey)).resolves.toEqual({
      status: 'expired',
    })
    expect(db.delete).toHaveBeenCalled()
  })
})
