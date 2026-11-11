import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CopilotSettings, DEFAULT_COPILOT_SETTINGS } from '@/lib/copilot/settings'

const {
  mockEq,
  mockEnsureDefaultUserSubscription,
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
  mockUserRows,
} = vi.hoisted(() => ({
  mockEq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  mockEnsureDefaultUserSubscription: vi.fn(),
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
  mockUserRows: vi.fn(),
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
  systemServiceValue: {
    id: 'system_service_values.id',
    value: 'system_service_values.value',
  },
  pendingExecution: {
    id: 'pending_execution.id',
  },
  user: { id: 'user.id' },
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  ensureDefaultUserSubscription: mockEnsureDefaultUserSubscription,
}))

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => mockEq(left, right),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => mockSql(strings, ...values),
}))

import {
  getCopilotSettings,
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
    mockSelectFrom.mockImplementation((table) =>
      table.id === 'user.id' ? mockUserRows() : { limit: mockSelectLimit, where: mockSelectWhere }
    )
    mockSelectWhere.mockImplementation(() => ({
      limit: mockSelectLimit,
    }))
    mockSelectLimit.mockResolvedValue([])
    mockInsert.mockImplementation(() => ({
      values: mockInsertValues,
    }))
    mockInsertValues.mockImplementation(() => ({
      onConflictDoUpdate: mockInsertOnConflictDoUpdate,
    }))
    mockTransaction.mockImplementation(async (callback) => callback(transactionStore))
    mockTransactionExecute.mockResolvedValue(undefined)
    mockUserRows.mockResolvedValue([])
    mockEnsureDefaultUserSubscription.mockReset().mockResolvedValue(undefined)
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
      copilot: DEFAULT_COPILOT_SETTINGS,
    })
  })

  it.each([null, { id: 'global', billingEnabled: false }])(
    'initializes billing activation users in the settings transaction before publishing its enabled flag (%j)',
    async (existing) => {
      mockSelectLimit
        .mockResolvedValueOnce(existing ? [existing] : [])
        .mockResolvedValueOnce([{ id: 'global', billingEnabled: true }])
      mockUserRows.mockResolvedValue([{ id: 'initial-admin' }, { id: 'earlier-signup' }])

      await expect(upsertSystemSettings({ billingEnabled: true })).resolves.toMatchObject({
        billingEnabled: true,
      })

      expect(mockEnsureDefaultUserSubscription.mock.calls).toEqual([
        ['initial-admin', transactionStore],
        ['earlier-signup', transactionStore],
      ])
      expect(mockTransactionExecute).toHaveBeenCalledTimes(2)
      expect(mockTransactionExecute.mock.calls[1][0]).toEqual({
        strings: ['LOCK TABLE ', ' IN SHARE MODE'],
        values: [{ id: 'user.id' }],
      })
      expect(mockTransactionExecute.mock.invocationCallOrder[1]).toBeLessThan(
        mockUserRows.mock.invocationCallOrder[0]
      )
      expect(mockUserRows.mock.invocationCallOrder[0]).toBeLessThan(
        mockEnsureDefaultUserSubscription.mock.invocationCallOrder[0]
      )
      expect(mockEnsureDefaultUserSubscription.mock.invocationCallOrder[1]).toBeLessThan(
        mockInsertValues.mock.invocationCallOrder[0]
      )
    }
  )

  it('does not publish billing activation when any subscription initialization fails', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ id: 'global', billingEnabled: false }])
    mockUserRows.mockResolvedValue([{ id: 'initial-admin' }, { id: 'earlier-signup' }])
    mockEnsureDefaultUserSubscription
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Subscription initialization failed'))

    await expect(upsertSystemSettings({ billingEnabled: true })).rejects.toThrow(
      'Subscription initialization failed'
    )

    expect(mockEnsureDefaultUserSubscription).toHaveBeenCalledTimes(2)
    expect(
      mockEnsureDefaultUserSubscription.mock.calls.every(([, store]) => store === transactionStore)
    ).toBe(true)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it.each([
    [true, { billingEnabled: true }],
    [true, { billingEnabled: false }],
    [false, { emailDomain: 'example.com' }],
  ] as const)(
    'does not provision subscriptions outside billing activation (%s, %j)',
    async (enabled, input) => {
      mockSelectLimit.mockResolvedValueOnce([{ id: 'global', billingEnabled: enabled }])
      await upsertSystemSettings(input)
      expect(mockUserRows).not.toHaveBeenCalled()
      expect(mockEnsureDefaultUserSubscription).not.toHaveBeenCalled()
      expect(mockTransactionExecute).toHaveBeenCalledOnce()
    }
  )

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
          triggerDevEnabled: false,
          allowPromotionCodes: false,
          emailDomain: 'mail.example.com',
          fromEmailAddress: null,
          createdAt: now,
          updatedAt: now,
        },
      ])

    const result = await upsertSystemSettings({
      billingEnabled: true,
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
      triggerDevEnabled: false,
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
        triggerDevEnabled: false,
        allowPromotionCodes: false,
        emailDomain: 'mail.example.com',
        fromEmailAddress: null,
        updatedAt: expect.any(Date),
      },
    })
    expect(result).toMatchObject({
      registrationMode: 'waitlist',
      billingEnabled: true,
      triggerDevEnabled: false,
      allowPromotionCodes: false,
      emailDomain: 'mail.example.com',
      fromEmailAddress: null,
    })
    expect(mockTransactionExecute).toHaveBeenCalledTimes(2)
    expect(mockTransactionExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockSelect.mock.invocationCallOrder[0]
    )
    expect(mockSelect.mock.invocationCallOrder[0]).toBeLessThan(
      mockInsert.mock.invocationCallOrder[0]
    )
  })

  it('persists a dynamic Copilot catalogue and preserves it when unrelated settings change', async () => {
    const copilot: CopilotSettings = {
      models: [{ provider: 'openai', model: 'future-model' }],
      defaultModel: 'openai/future-model',
    }
    mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'global' }])
      .mockResolvedValueOnce([{ value: JSON.stringify(copilot) }])

    await expect(upsertSystemSettings({ copilot })).resolves.toMatchObject({ copilot })
    expect(mockInsertValues).toHaveBeenLastCalledWith({
      id: 'copilot:setting:configuration',
      service: 'copilot',
      kind: 'setting',
      key: 'configuration',
      value: JSON.stringify(copilot),
    })
    expect(mockInsertOnConflictDoUpdate).toHaveBeenLastCalledWith({
      target: 'system_service_values.id',
      set: { value: JSON.stringify(copilot), updatedAt: expect.any(Date) },
    })
    mockInsert.mockClear()
    mockInsertValues.mockClear()

    mockSelectLimit
      .mockResolvedValueOnce([{ id: 'global' }])
      .mockResolvedValueOnce([{ id: 'global' }])
      .mockResolvedValueOnce([{ value: JSON.stringify(copilot) }])
    await expect(upsertSystemSettings({ emailDomain: 'example.com' })).resolves.toMatchObject({
      copilot,
    })

    expect(mockInsert).toHaveBeenCalledExactlyOnceWith({ id: 'system_settings.id' })
    expect(mockInsertValues.mock.calls[0][0]).not.toHaveProperty('copilot')
  })

  it('reads Copilot configuration directly from its service value without global settings', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ value: JSON.stringify(DEFAULT_COPILOT_SETTINGS) }])
    await expect(getCopilotSettings()).resolves.toEqual(DEFAULT_COPILOT_SETTINGS)
    expect(mockSelect).toHaveBeenCalledExactlyOnceWith({ value: 'system_service_values.value' })
    expect(mockSelectWhere).toHaveBeenCalledWith({
      kind: 'eq',
      left: 'system_service_values.id',
      right: 'copilot:setting:configuration',
    })
  })

  it('does not replace invalid saved configuration with a built-in catalogue', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { value: JSON.stringify({ models: [], defaultModel: 'openai/removed-model' }) },
      ])

    await expect(getResolvedSystemSettings()).rejects.toThrow()
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
