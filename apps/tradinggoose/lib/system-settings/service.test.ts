import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEq,
  mockInsert,
  mockInsertOnConflictDoUpdate,
  mockInsertValues,
  mockSelect,
  mockSelectFrom,
  mockSelectLimit,
  mockSelectWhere,
} = vi.hoisted(() => ({
  mockEq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
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

  it('returns app-owned defaults when no system settings record exists', async () => {
    mockSelectLimit.mockResolvedValueOnce([])

    const result = await getResolvedSystemSettings()

    expect(result).toMatchObject({
      settings: null,
      registrationMode: 'open',
      billingEnabled: false,
      triggerDevEnabled: false,
      allowPromotionCodes: true,
      emailDomain: 'tradinggoose.ai',
      fromEmailAddress: null,
    })
  })

  it('upserts only app-owned settings and preserves omitted values', async () => {
    const now = new Date('2026-04-12T00:00:00.000Z')

    mockSelectLimit
      .mockResolvedValueOnce([
        {
          id: 'global',
          registrationMode: 'waitlist',
          billingEnabled: false,
          triggerDevEnabled: false,
          allowPromotionCodes: false,
          emailDomain: 'old.example.com',
          fromEmailAddress: 'TradingGoose <noreply@old.example.com>',
          createdAt: now,
          updatedAt: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'global',
          registrationMode: 'waitlist',
          billingEnabled: true,
          triggerDevEnabled: true,
          allowPromotionCodes: false,
          emailDomain: 'mail.example.com',
          fromEmailAddress: null,
          createdAt: now,
          updatedAt: now,
        },
      ])

    const result = await upsertSystemSettings({
      billingEnabled: true,
      triggerDevEnabled: true,
      emailDomain: 'mail.example.com',
      fromEmailAddress: '',
    })

    expect(mockInsert).toHaveBeenCalledWith({
      id: 'system_settings.id',
    })
    expect(mockInsertValues).toHaveBeenCalledWith({
      id: 'global',
      registrationMode: 'waitlist',
      billingEnabled: true,
      triggerDevEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'mail.example.com',
      fromEmailAddress: null,
      createdAt: now,
      updatedAt: expect.any(Date),
    })
    expect(mockInsertOnConflictDoUpdate).toHaveBeenCalledWith({
      target: 'system_settings.id',
      set: {
        registrationMode: 'waitlist',
        billingEnabled: true,
        triggerDevEnabled: true,
        allowPromotionCodes: false,
        emailDomain: 'mail.example.com',
        fromEmailAddress: null,
        updatedAt: expect.any(Date),
      },
    })
    expect(result).toMatchObject({
      registrationMode: 'waitlist',
      billingEnabled: true,
      triggerDevEnabled: true,
      allowPromotionCodes: false,
      emailDomain: 'mail.example.com',
      fromEmailAddress: null,
    })
  })
})

describe('trigger settings helper', () => {
  it('reports ready only when both Trigger.dev credentials are configured', async () => {
    vi.resetModules()
    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_PROJECT_ID: 'proj_123',
        TRIGGER_SECRET_KEY: 'tr_dev_123',
      },
    }))

    const { isTriggerConfigurationReady } = await import('@/lib/trigger/settings')

    expect(isTriggerConfigurationReady()).toBe(true)
  })

  it('reports not ready when either Trigger.dev credential is missing', async () => {
    vi.resetModules()
    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_PROJECT_ID: 'proj_123',
        TRIGGER_SECRET_KEY: '',
      },
    }))

    const { isTriggerConfigurationReady } = await import('@/lib/trigger/settings')

    expect(isTriggerConfigurationReady()).toBe(false)
  })
})
