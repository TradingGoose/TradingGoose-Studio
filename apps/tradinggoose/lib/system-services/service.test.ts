import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const mockGetCachedValue = vi.fn()
const mockSetCachedValue = vi.fn()
const credentialRow = {
  id: 'browserbase:credential:apiKey',
  service: 'browserbase',
  kind: 'credential',
  key: 'apiKey',
  value: 'encrypted-api-key',
}
const settingRow = {
  id: 'browserbase:setting:projectId',
  service: 'browserbase',
  kind: 'setting',
  key: 'projectId',
  value: 'proj_123',
}

vi.mock('@/lib/redis', () => ({
  getCachedValue: (...args: unknown[]) => mockGetCachedValue(...args),
  setCachedValue: (...args: unknown[]) => mockSetCachedValue(...args),
}))

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

vi.mock('./catalog', async (original) => {
  const catalog = await original<typeof import('./catalog')>()
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

  const getDefinition = (serviceId: string) =>
    serviceId === definition.id ? definition : catalog.getSystemServiceDefinition(serviceId)

  return {
    getSystemServiceDefinitions: () => [definition],
    getSystemServiceDefinition: getDefinition,
    isSystemServiceCredentialKey: (serviceId: string, key: string) =>
      getDefinition(serviceId)?.credentialFields.some((field) => field.key === key) ?? false,
    isSystemServiceSettingKey: (serviceId: string, key: string) =>
      getDefinition(serviceId)?.settingFields.some((field) => field.key === key) ?? false,
  }
})

describe('system services service', () => {
  afterEach(() => {
    expect(mockGetCachedValue).not.toHaveBeenCalled()
    expect(mockSetCachedValue).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptSecret.mockReset()
    mockSelectWhere.mockReset()

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

    mockSelectOrderBy.mockResolvedValueOnce([credentialRow, settingRow])

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
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('resolves credentials and settings from the unified table', async () => {
    const { resolveSystemServiceConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([credentialRow, settingRow])
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'real-api-key' })

    const result = await resolveSystemServiceConfig('browserbase')

    expect(result).toEqual({
      apiKey: 'real-api-key',
      projectId: 'proj_123',
    })
    expect(mockSelect).toHaveBeenCalledOnce()
    expect(mockSelectWhere).toHaveBeenCalledWith({
      kind: 'eq',
      left: 'system_service_values.service',
      right: 'browserbase',
    })
  })

  it('resolves settings without decrypting credentials when only public config is needed', async () => {
    const { resolveSystemServiceSettingsConfig } = await import('./service')

    mockSelectWhere.mockResolvedValueOnce([settingRow])

    const result = await resolveSystemServiceSettingsConfig('browserbase')

    expect(result).toEqual({
      projectId: 'proj_123',
    })
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('decrypts current credentials on every call without using shared Redis', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere
      .mockResolvedValueOnce([credentialRow, settingRow])
      .mockResolvedValueOnce([credentialRow, { ...settingRow, value: 'proj_updated' }])
    mockDecryptSecret.mockResolvedValue({ decrypted: '  real-api-key  ' })

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({
      apiKey: 'real-api-key',
      projectId: 'proj_123',
    })
    expect(await resolveSystemServiceConfig('browserbase')).toEqual({
      apiKey: 'real-api-key',
      projectId: 'proj_updated',
    })
    expect(mockSelect).toHaveBeenCalledTimes(2)
    expect(mockDecryptSecret).toHaveBeenCalledTimes(2)
    expect(mockDecryptSecret).toHaveBeenNthCalledWith(1, 'encrypted-api-key')
    expect(mockDecryptSecret).toHaveBeenNthCalledWith(2, 'encrypted-api-key')
  })

  it('stops resolving credentials when their DB rows are removed', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere.mockResolvedValueOnce([credentialRow]).mockResolvedValueOnce([])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'old-key' })
    await resolveSystemServiceConfig('browserbase')

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({})
    expect(mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('decrypts the rotated credential under the same row ID', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere
      .mockResolvedValueOnce([credentialRow])
      .mockResolvedValueOnce([{ ...credentialRow, value: 'encrypted-new-key' }])
    mockDecryptSecret
      .mockResolvedValueOnce({ decrypted: 'old-key' })
      .mockResolvedValueOnce({ decrypted: 'new-key' })
    await resolveSystemServiceConfig('browserbase')

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({ apiKey: 'new-key' })
    expect(mockDecryptSecret).toHaveBeenLastCalledWith('encrypted-new-key')
  })

  it('propagates a DB failure', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere
      .mockResolvedValueOnce([credentialRow])
      .mockRejectedValueOnce(new Error('DB unavailable'))
    mockDecryptSecret.mockResolvedValue({ decrypted: 'key' })
    await resolveSystemServiceConfig('browserbase')

    await expect(resolveSystemServiceConfig('browserbase')).rejects.toThrow('DB unavailable')
  })

  it.each(['', '   ', new Error('Decryption failed')])(
    'omits unusable credentials: %j',
    async (value) => {
      const { resolveSystemServiceConfig } = await import('./service')
      mockSelectWhere.mockResolvedValue([credentialRow])
      mockDecryptSecret
        .mockResolvedValueOnce({ decrypted: 'previous-key' })
        .mockImplementationOnce(async () => {
          if (value instanceof Error) throw value
          return { decrypted: value }
        })

      expect(await resolveSystemServiceConfig('browserbase')).toEqual({ apiKey: 'previous-key' })
      expect(await resolveSystemServiceConfig('browserbase')).toEqual({})
      expect(mockDecryptSecret).toHaveBeenCalledTimes(2)
    }
  )

  it('writes credentials and settings back into one table with kind-specific ids', async () => {
    const { upsertSystemServiceConfig } = await import('./service')

    const createdAt = new Date('2026-04-12T00:00:00.000Z')

    mockSelectWhere.mockResolvedValueOnce([
      { ...credentialRow, value: 'encrypted-old', createdAt },
      { ...settingRow, value: 'proj_old', createdAt },
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

  it('requires one complete settings update and refuses credentials as settings', async () => {
    const { upsertSystemServiceConfig } = await import('./service')
    await expect(
      upsertSystemServiceConfig({
        serviceId: 'browserbase',
        credentials: [{ key: 'apiKey', value: 'key', hasValue: false }],
        settings: [],
      })
    ).rejects.toThrow('must provide all setting fields')
    await expect(
      upsertSystemServiceConfig({
        serviceId: 'browserbase',
        credentials: [{ key: 'apiKey', value: 'key', hasValue: false }],
        settings: [{ key: 'apiKey', value: 'plaintext-key', hasValue: false }],
      })
    ).rejects.toThrow('Unknown setting key')
    expect(mockEncryptSecret).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
