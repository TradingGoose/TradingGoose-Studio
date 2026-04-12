import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEq,
  mockDecryptSecret,
  mockEncryptSecret,
  mockInsert,
  mockInsertOnConflictDoUpdate,
  mockInsertValues,
  mockSelect,
  mockSelectFrom,
  mockSelectLimit,
  mockSelectWhere,
} = vi.hoisted(() => ({
  mockEq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  mockDecryptSecret: vi.fn(),
  mockEncryptSecret: vi.fn(async (value: string) => ({
    encrypted: `encrypted:${value}`,
  })),
  mockInsert: vi.fn(),
  mockInsertOnConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  mockInsertValues: vi.fn(),
  mockSelect: vi.fn(),
  mockSelectFrom: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockSelectWhere: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemSettings: {
    id: 'system_settings.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => mockEq(left, right),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/utils', () => ({
  decryptSecret: (value: string) => mockDecryptSecret(value),
  encryptSecret: (value: string) => mockEncryptSecret(value),
}))

import { getResolvedSystemSettings, upsertSystemSettings } from './service'

describe('system settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockImplementation(() => ({
      from: mockSelectFrom,
    }))
    mockSelectFrom.mockImplementation(() => ({
      where: mockSelectWhere,
    }))
    mockSelectWhere.mockImplementation(() => ({
      limit: mockSelectLimit,
    }))
    mockInsert.mockImplementation(() => ({
      values: mockInsertValues,
    }))
    mockInsertValues.mockImplementation(() => ({
      onConflictDoUpdate: mockInsertOnConflictDoUpdate,
    }))
  })

  it('decrypts Stripe secrets from system settings records', async () => {
    const now = new Date('2026-04-11T00:00:00.000Z')

    mockSelectLimit.mockResolvedValue([
      {
        id: 'global',
        registrationMode: 'waitlist',
        billingEnabled: true,
        allowPromotionCodes: false,
        stripeSecretKey: 'encrypted:secret',
        stripeWebhookSecret: 'encrypted:webhook',
        createdAt: now,
        updatedAt: now,
      },
    ])
    mockDecryptSecret
      .mockResolvedValueOnce({ decrypted: 'sk_live_123' })
      .mockResolvedValueOnce({ decrypted: 'whsec_123' })

    const result = await getResolvedSystemSettings()

    expect(result.registrationMode).toBe('waitlist')
    expect(result.billingEnabled).toBe(true)
    expect(result.allowPromotionCodes).toBe(false)
    expect(result.stripeSecretKey).toBe('sk_live_123')
    expect(result.stripeWebhookSecret).toBe('whsec_123')
    expect(mockDecryptSecret).toHaveBeenCalledTimes(2)
  })

  it('preserves omitted encrypted Stripe secrets during partial updates', async () => {
    const now = new Date('2026-04-11T00:00:00.000Z')

    mockSelectLimit
      .mockResolvedValueOnce([
        {
          id: 'global',
          registrationMode: 'open',
          billingEnabled: false,
          allowPromotionCodes: true,
          stripeSecretKey: 'encrypted:existing-secret',
          stripeWebhookSecret: 'encrypted:existing-webhook',
          createdAt: now,
          updatedAt: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'global',
          registrationMode: 'open',
          billingEnabled: true,
          allowPromotionCodes: false,
          stripeSecretKey: 'encrypted:sk_live_next',
          stripeWebhookSecret: 'encrypted:existing-webhook',
          createdAt: now,
          updatedAt: now,
        },
      ])

    mockDecryptSecret
      .mockResolvedValueOnce({ decrypted: 'sk_live_next' })
      .mockResolvedValueOnce({ decrypted: 'whsec_existing' })

    await upsertSystemSettings({
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'sk_live_next',
    })

    expect(mockEncryptSecret).toHaveBeenCalledWith('sk_live_next')
    expect(mockInsert).toHaveBeenCalledWith({
      id: 'system_settings.id',
    })
    expect(mockInsertValues).toHaveBeenCalledWith({
      id: 'global',
      registrationMode: 'open',
      billingEnabled: true,
      allowPromotionCodes: false,
      stripeSecretKey: 'encrypted:sk_live_next',
      stripeWebhookSecret: 'encrypted:existing-webhook',
      createdAt: now,
      updatedAt: expect.any(Date),
    })
    expect(mockInsertOnConflictDoUpdate).toHaveBeenCalledWith({
      target: 'system_settings.id',
      set: {
        registrationMode: 'open',
        billingEnabled: true,
        allowPromotionCodes: false,
        stripeSecretKey: 'encrypted:sk_live_next',
        stripeWebhookSecret: 'encrypted:existing-webhook',
        updatedAt: expect.any(Date),
      },
    })
  })
})
