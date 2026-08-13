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
  mockSql,
  mockTransaction,
  mockTransactionExecute,
} = vi.hoisted(() => ({
  mockEq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  mockInsert: vi.fn(),
  mockInsertOnConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  mockInsertValues: vi.fn(),
  mockSelect: vi.fn(),
  mockSelectFrom: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  mockTransaction: vi.fn(),
  mockTransactionExecute: vi.fn(),
}))

const transactionStore = {
  execute: (...args: unknown[]) => mockTransactionExecute(...args),
  insert: (...args: unknown[]) => mockInsert(...args),
  select: (...args: unknown[]) => mockSelect(...args),
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemSettings: {
    id: 'system_settings.id',
  },
  pendingExecution: {
    id: 'pending_execution.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => mockEq(left, right),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => mockSql(strings, ...values),
}))

import {
  getResolvedSystemSettings,
  TriggerExecutionBusyError,
  upsertSystemSettings,
} from './service'

describe('system settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockImplementation(() => ({
      from: mockSelectFrom,
    }))
    mockSelectFrom.mockImplementation(() => ({
      limit: mockSelectLimit,
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
    mockTransaction.mockImplementation(async (callback) => callback(transactionStore))
    mockTransactionExecute.mockResolvedValue(undefined)
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
      .mockResolvedValueOnce([])
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
    expect(mockTransactionExecute).toHaveBeenCalledOnce()
    expect(mockTransactionExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockSelect.mock.invocationCallOrder[0]
    )
    expect(mockSelect.mock.invocationCallOrder[1]).toBeLessThan(
      mockInsert.mock.invocationCallOrder[0]
    )
  })

  it('rejects an execution-mode switch under the lock before writing when work exists', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([
        {
          id: 'global',
          triggerDevEnabled: false,
        },
      ])
      .mockResolvedValueOnce([{ id: 'pending-1' }])

    await expect(upsertSystemSettings({ triggerDevEnabled: true })).rejects.toBeInstanceOf(
      TriggerExecutionBusyError
    )

    expect(mockTransactionExecute).toHaveBeenCalledOnce()
    expect(mockInsert).not.toHaveBeenCalled()
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
      getEnv: vi.fn(() => ''),
      isTruthy: vi.fn(() => false),
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
      getEnv: vi.fn(() => ''),
      isTruthy: vi.fn(() => false),
    }))

    const { isTriggerConfigurationReady } = await import('@/lib/trigger/settings')

    expect(isTriggerConfigurationReady()).toBe(false)
  })
})
