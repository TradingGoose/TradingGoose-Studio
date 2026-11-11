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
const mockGetCachedValue = vi.fn()
const mockSetCachedValue = vi.fn()
const mockDeleteCachedValue = vi.fn()
const mockLoggerWarn = vi.fn()
const cache = new Map<string, string>()
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
  deleteCachedValue: (...args: unknown[]) => mockDeleteCachedValue(...args),
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
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
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
    cache.clear()
    mockDecryptSecret.mockReset()
    mockSelectWhere.mockReset()
    mockGetCachedValue.mockReset().mockImplementation(async (key: string) => cache.get(key) ?? null)
    mockSetCachedValue.mockReset().mockImplementation(async (key: string, value: string) => {
      cache.set(key, value)
    })
    mockDeleteCachedValue.mockReset().mockImplementation(async (key: string) => {
      cache.delete(key)
    })

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
    expect(mockGetCachedValue).not.toHaveBeenCalled()
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
    expect(mockGetCachedValue).not.toHaveBeenCalled()
    expect(mockSetCachedValue).not.toHaveBeenCalled()
  })

  it('reuses decryption while reading current credentials and settings on every call', async () => {
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
    expect(mockDecryptSecret).toHaveBeenCalledExactlyOnceWith('encrypted-api-key')
    expect(mockSetCachedValue).toHaveBeenCalledWith(
      'system-service-credential:browserbase:credential:apiKey',
      expect.any(String),
      60
    )
  })

  it('does not reuse a hot credential cache after the DB row is removed', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere.mockResolvedValueOnce([credentialRow]).mockResolvedValueOnce([])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'old-key' })
    await resolveSystemServiceConfig('browserbase')

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({})
    expect(cache.size).toBe(1)
    expect(mockGetCachedValue).toHaveBeenCalledOnce()
    expect(mockDecryptSecret).toHaveBeenCalledOnce()
  })

  it('uses the rotated credential despite a hot cache under the same row ID', async () => {
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
    expect(cache.size).toBe(1)
  })

  it('ignores an old fill completing after rotation on the next invocation', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    let finishDecryption!: (value: { decrypted: string }) => void
    const pending = new Promise<{ decrypted: string }>((resolve) => {
      finishDecryption = resolve
    })
    mockSelectWhere.mockResolvedValue([credentialRow])
    mockDecryptSecret.mockReturnValueOnce(pending).mockResolvedValue({ decrypted: 'new-key' })
    const oldRequest = resolveSystemServiceConfig('browserbase')
    await vi.waitFor(() => expect(mockDecryptSecret).toHaveBeenCalledOnce())
    mockSelectWhere.mockResolvedValue([{ ...credentialRow, value: 'encrypted-new-key' }])
    expect(await resolveSystemServiceConfig('browserbase')).toEqual({ apiKey: 'new-key' })
    finishDecryption({ decrypted: 'old-key' })
    expect(await oldRequest).toEqual({ apiKey: 'old-key' })

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({ apiKey: 'new-key' })
    expect(mockDecryptSecret).toHaveBeenCalledTimes(3)
    expect(mockDecryptSecret).toHaveBeenLastCalledWith('encrypted-new-key')
  })

  it('does not authorize a removed credential after its delayed fill finishes', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    let finishDecryption!: (value: { decrypted: string }) => void
    const pending = new Promise<{ decrypted: string }>((resolve) => {
      finishDecryption = resolve
    })
    mockSelectWhere.mockResolvedValue([credentialRow])
    mockDecryptSecret.mockReturnValueOnce(pending)
    const oldRequest = resolveSystemServiceConfig('browserbase')
    await vi.waitFor(() => expect(mockDecryptSecret).toHaveBeenCalledOnce())
    mockSelectWhere.mockResolvedValue([])
    finishDecryption({ decrypted: 'old-key' })
    expect(await oldRequest).toEqual({ apiKey: 'old-key' })

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({})
    expect(cache.size).toBe(1)
    expect(mockGetCachedValue).toHaveBeenCalledOnce()
  })

  it('propagates a DB failure instead of serving a hot cache', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere
      .mockResolvedValueOnce([credentialRow])
      .mockRejectedValueOnce(new Error('DB unavailable'))
    mockDecryptSecret.mockResolvedValue({ decrypted: 'key' })
    await resolveSystemServiceConfig('browserbase')

    await expect(resolveSystemServiceConfig('browserbase')).rejects.toThrow('DB unavailable')
    expect(mockGetCachedValue).toHaveBeenCalledOnce()
  })

  it.each(['read', 'write'])(
    'decrypts current credentials when the cache %s fails',
    async (operation) => {
      const { resolveSystemServiceConfig } = await import('./service')
      mockSelectWhere.mockResolvedValueOnce([credentialRow, settingRow])
      mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'current-key' })
      const failedOperation = operation === 'read' ? mockGetCachedValue : mockSetCachedValue
      failedOperation.mockRejectedValueOnce(new Error('Redis unavailable'))

      expect(await resolveSystemServiceConfig('browserbase')).toEqual({
        apiKey: 'current-key',
        projectId: 'proj_123',
      })
      expect(mockLoggerWarn).toHaveBeenCalledOnce()
    }
  )

  it('decrypts again when the cache entry has expired or been evicted', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    mockSelectWhere.mockResolvedValue([credentialRow])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'current-key' })
    await resolveSystemServiceConfig('browserbase')
    cache.clear()

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({ apiKey: 'current-key' })
    expect(mockDecryptSecret).toHaveBeenCalledTimes(2)
  })

  it('replaces corrupt cache JSON with the current decrypted credential', async () => {
    const { resolveSystemServiceConfig } = await import('./service')
    const cacheKey = 'system-service-credential:browserbase:credential:apiKey'
    cache.set(cacheKey, '{"value":"stale-key"')
    mockSelectWhere.mockResolvedValueOnce([credentialRow])
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'current-key' })

    expect(await resolveSystemServiceConfig('browserbase')).toEqual({ apiKey: 'current-key' })
    expect(mockDeleteCachedValue).toHaveBeenCalledWith(cacheKey)
    expect(JSON.parse(cache.get(cacheKey)!)).toMatchObject({ value: 'current-key' })
    expect(mockLoggerWarn).toHaveBeenCalledOnce()
  })

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
})
