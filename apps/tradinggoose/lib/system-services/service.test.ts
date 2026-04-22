import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAnd = vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions }))
const mockDecryptSecret = vi.fn()
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
const mockEq = vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right }))
const mockEncryptSecret = vi.fn()
const mockInsertValues = vi.fn().mockResolvedValue(undefined)
const mockSelect = vi.fn()
const mockSelectFrom = vi.fn()
const mockSelectOrderBy = vi.fn()
const mockSelectWhere = vi.fn()
const mockTransaction = vi.fn()
const mockTxDelete = vi.fn()
const mockTxInsert = vi.fn()

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemServiceValue: {
    id: 'system_service_values.id',
    service: 'system_service_values.service',
    kind: 'system_service_values.kind',
    key: 'system_service_values.key',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => mockAnd(...conditions),
  eq: (left: unknown, right: unknown) => mockEq(left, right),
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args),
  encryptSecret: (...args: unknown[]) => mockEncryptSecret(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('./catalog', () => {
  const definition = {
    id: 'browserbase',
    displayName: 'Browserbase',
    description: 'Browser sessions',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Credential',
      },
    ],
    settingFields: [
      {
        key: 'projectId',
        label: 'Project ID',
        description: 'Project',
        type: 'text',
      },
    ],
  }

  return {
    getSystemServiceDefinitions: () => [definition],
    getSystemServiceDefinition: (serviceId: string) =>
      serviceId === definition.id ? definition : undefined,
    isSystemServiceCredentialKey: (serviceId: string, key: string) =>
      serviceId === definition.id && key === 'apiKey',
    isSystemServiceSettingKey: (serviceId: string, key: string) =>
      serviceId === definition.id && key === 'projectId',
  }
})

describe('system services service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockImplementation(() => ({
      from: mockSelectFrom,
    }))
    mockSelectFrom.mockImplementation(() => ({
      orderBy: mockSelectOrderBy,
      where: mockSelectWhere,
    }))
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        delete: mockTxDelete,
        insert: mockTxInsert,
      })
    )
    mockTxDelete.mockImplementation(() => ({
      where: mockDeleteWhere,
    }))
    mockTxInsert.mockImplementation(() => ({
      values: mockInsertValues,
    }))
  })

  it('lists credentials and settings from the unified system service values table', async () => {
    const { listSystemServices } = await import('./service')

    mockSelectOrderBy.mockResolvedValueOnce([
      {
        id: 'browserbase:credential:apiKey',
        service: 'browserbase',
        kind: 'credential',
        key: 'apiKey',
        value: 'encrypted-api-key',
      },
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_123',
      },
    ])

    const result = await listSystemServices()

    expect(result).toEqual([
      {
        id: 'browserbase',
        displayName: 'Browserbase',
        description: 'Browser sessions',
        credentials: [{ key: 'apiKey', hasValue: true }],
        settings: [{ key: 'projectId', hasValue: true, storedValue: 'proj_123' }],
      },
    ])
  })

  it('resolves credentials and settings from the unified table', async () => {
    const { resolveSystemServiceConfig } = await import('./service')

    mockSelectWhere
      .mockResolvedValueOnce([
        {
          id: 'browserbase:credential:apiKey',
          service: 'browserbase',
          kind: 'credential',
          key: 'apiKey',
          value: 'encrypted-api-key',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'browserbase:setting:projectId',
          service: 'browserbase',
          kind: 'setting',
          key: 'projectId',
          value: 'proj_123',
        },
      ])
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'real-api-key' })

    const result = await resolveSystemServiceConfig('browserbase')

    expect(result).toEqual({
      apiKey: 'real-api-key',
      projectId: 'proj_123',
    })
  })

  it('resolves settings without decrypting credentials when only public config is needed', async () => {
    const { resolveSystemServiceSettingsConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_123',
      },
    ])

    const result = await resolveSystemServiceSettingsConfig('browserbase')

    expect(result).toEqual({
      projectId: 'proj_123',
    })
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('writes credentials and settings back into one table with kind-specific ids', async () => {
    const { upsertSystemServiceConfig } = await import('./service')

    const createdAt = new Date('2026-04-12T00:00:00.000Z')

    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 'browserbase:credential:apiKey',
        service: 'browserbase',
        kind: 'credential',
        key: 'apiKey',
        value: 'encrypted-old',
        createdAt,
      },
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_old',
        createdAt,
      },
    ])
    mockEncryptSecret.mockResolvedValueOnce({ encrypted: 'encrypted-new' })

    await upsertSystemServiceConfig({
      serviceId: 'browserbase',
      credentials: [{ key: 'apiKey', value: 'next-api-key', hasValue: true }],
      settings: [{ key: 'projectId', value: 'proj_next', hasValue: true }],
    })

    expect(mockTxDelete).toHaveBeenCalledWith({
      id: 'system_service_values.id',
      service: 'system_service_values.service',
      kind: 'system_service_values.kind',
      key: 'system_service_values.key',
    })
    expect(mockDeleteWhere).toHaveBeenCalled()
    expect(mockTxInsert).toHaveBeenCalledWith({
      id: 'system_service_values.id',
      service: 'system_service_values.service',
      kind: 'system_service_values.kind',
      key: 'system_service_values.key',
    })
    expect(mockInsertValues).toHaveBeenCalledWith([
      {
        id: 'browserbase:credential:apiKey',
        service: 'browserbase',
        kind: 'credential',
        key: 'apiKey',
        value: 'encrypted-new',
        createdAt,
        updatedAt: expect.any(Date),
      },
      {
        id: 'browserbase:setting:projectId',
        service: 'browserbase',
        kind: 'setting',
        key: 'projectId',
        value: 'proj_next',
        createdAt,
        updatedAt: expect.any(Date),
      },
    ])
  })
})
