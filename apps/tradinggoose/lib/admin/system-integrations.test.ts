import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockEq, mockCredentialFields } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  mockCredentialFields: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemIntegrationDefinition: {
    id: 'system_integration_definition.id',
  },
  systemIntegrationSecret: {
    definitionId: 'system_integration_secret.definition_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => mockEq(left, right),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/utils-server', () => ({
  encryptSecret: vi.fn(async (value: string) => ({
    encrypted: `encrypted:${value}`,
  })),
}))

vi.mock('@/lib/system-integrations/catalog', () => ({
  getSystemIntegrationCatalogSeedSnapshot: vi.fn(() => ({
    definitions: [
      {
        id: 'bundle:airtable',
        parentId: null,
        name: 'Airtable',
        isEnabled: null,
      },
      {
        id: 'airtable',
        parentId: 'bundle:airtable',
        name: 'Airtable',
        isEnabled: true,
      },
      {
        id: 'bundle:alpaca',
        parentId: null,
        name: 'Alpaca',
        isEnabled: null,
      },
      {
        id: 'alpaca',
        parentId: 'bundle:alpaca',
        name: 'Alpaca',
        isEnabled: true,
      },
    ],
    secrets: [
      {
        id: 'system-integration-secret:bundle:airtable:client_id',
        definitionId: 'bundle:airtable',
        key: 'client_id',
        required: true,
        value: '',
      },
      {
        id: 'system-integration-secret:bundle:airtable:client_secret',
        definitionId: 'bundle:airtable',
        key: 'client_secret',
        required: true,
        value: '',
      },
      {
        id: 'system-integration-secret:bundle:alpaca:client_id',
        definitionId: 'bundle:alpaca',
        key: 'client_id',
        required: true,
        value: '',
      },
      {
        id: 'system-integration-secret:bundle:alpaca:client_secret',
        definitionId: 'bundle:alpaca',
        key: 'client_secret',
        required: true,
        value: '',
      },
    ],
  })),
  getSystemIntegrationCatalogCredentialFields: mockCredentialFields,
  getSystemIntegrationCatalogDefinitionIds: vi.fn(
    () => new Set(['bundle:airtable', 'airtable', 'bundle:alpaca', 'alpaca'])
  ),
}))

import { updateSystemIntegrationBundle } from './system-integrations'

describe('system integration bundle persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredentialFields.mockReturnValue([])
  })

  it('only replaces the target bundle subtree and its secrets', async () => {
    const { deleteWhere, insertValues, tx } = configureTransaction()

    await updateSystemIntegrationBundle({
      definition: {
        id: 'bundle:airtable',
        parentId: null,
        name: 'Airtable',
        isEnabled: null,
      },
      services: [
        {
          id: 'airtable',
          parentId: 'bundle:airtable',
          name: 'Airtable',
          isEnabled: true,
        },
      ],
      secrets: [
        {
          id: 'system-integration-secret:bundle:airtable:client_id',
          definitionId: 'bundle:airtable',
          key: 'client_id',
          value: 'client-id',
          hasValue: false,
        },
        {
          id: 'system-integration-secret:bundle:airtable:client_secret',
          definitionId: 'bundle:airtable',
          key: 'client_secret',
          value: 'client-secret',
          hasValue: false,
        },
      ],
    })

    expect(tx.delete).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledWith({
      kind: 'eq',
      left: 'system_integration_definition.id',
      right: 'bundle:airtable',
    })

    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(insertValues).toHaveBeenNthCalledWith(2, [
      {
        id: 'bundle:airtable',
        parentId: null,
        name: 'Airtable',
        isEnabled: null,
      },
      {
        id: 'airtable',
        parentId: 'bundle:airtable',
        name: 'Airtable',
        isEnabled: true,
      },
    ])
    expect(insertValues).toHaveBeenNthCalledWith(3, [
      {
        id: 'system-integration-secret:bundle:airtable:client_id',
        definitionId: 'bundle:airtable',
        key: 'client_id',
        value: 'encrypted:client-id',
      },
      {
        id: 'system-integration-secret:bundle:airtable:client_secret',
        definitionId: 'bundle:airtable',
        key: 'client_secret',
        value: 'encrypted:client-secret',
      },
    ])
  })

  it('forces the bundle and child services disabled when required secrets are incomplete', async () => {
    const { insertValues } = configureTransaction()

    await updateSystemIntegrationBundle({
      definition: {
        id: 'bundle:airtable',
        parentId: null,
        name: 'Airtable',
        isEnabled: null,
      },
      services: [
        {
          id: 'airtable',
          parentId: 'bundle:airtable',
          name: 'Airtable',
          isEnabled: true,
        },
      ],
      secrets: [
        {
          id: 'system-integration-secret:bundle:airtable:client_id',
          definitionId: 'bundle:airtable',
          key: 'client_id',
          value: 'client-id',
          hasValue: false,
        },
        {
          id: 'system-integration-secret:bundle:airtable:client_secret',
          definitionId: 'bundle:airtable',
          key: 'client_secret',
          value: '',
          hasValue: false,
        },
      ],
    })

    expect(insertValues).toHaveBeenNthCalledWith(2, [
      {
        id: 'bundle:airtable',
        parentId: null,
        name: 'Airtable',
        isEnabled: null,
      },
      {
        id: 'airtable',
        parentId: 'bundle:airtable',
        name: 'Airtable',
        isEnabled: false,
      },
    ])
    expect(insertValues).toHaveBeenNthCalledWith(3, [
      {
        id: 'system-integration-secret:bundle:airtable:client_id',
        definitionId: 'bundle:airtable',
        key: 'client_id',
        value: 'encrypted:client-id',
      },
    ])
  })

  it('preserves existing encrypted secrets when reads only expose presence flags', async () => {
    mockCredentialFields.mockReturnValue([{ key: 'client_id', systemManaged: true }])
    const { insertValues, lock, readSecrets } = configureTransaction([
      {
        id: 'system-integration-secret:bundle:airtable:client_id',
        definitionId: 'bundle:airtable',
        key: 'client_id',
        value: 'encrypted:existing-client-id',
      },
      {
        id: 'system-integration-secret:bundle:airtable:client_secret',
        definitionId: 'bundle:airtable',
        key: 'client_secret',
        value: 'encrypted:existing-client-secret',
      },
    ])

    await updateSystemIntegrationBundle({
      definition: {
        id: 'bundle:airtable',
        parentId: null,
        name: 'Airtable',
        isEnabled: null,
      },
      services: [
        {
          id: 'airtable',
          parentId: 'bundle:airtable',
          name: 'Airtable',
          isEnabled: true,
        },
      ],
      secrets: [
        {
          id: 'system-integration-secret:bundle:airtable:client_id',
          definitionId: 'bundle:airtable',
          key: 'client_id',
          value: 'admin-overwrite',
          hasValue: false,
        },
        {
          id: 'system-integration-secret:bundle:airtable:client_secret',
          definitionId: 'bundle:airtable',
          key: 'client_secret',
          value: '',
          hasValue: true,
        },
      ],
    })

    expect(insertValues).toHaveBeenNthCalledWith(3, [
      {
        id: 'system-integration-secret:bundle:airtable:client_id',
        definitionId: 'bundle:airtable',
        key: 'client_id',
        value: 'encrypted:existing-client-id',
      },
      {
        id: 'system-integration-secret:bundle:airtable:client_secret',
        definitionId: 'bundle:airtable',
        key: 'client_secret',
        value: 'encrypted:existing-client-secret',
      },
    ])
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(readSecrets.mock.invocationCallOrder[0]!)
  })
})

function configureTransaction(
  existingSecrets: Array<{ id: string; definitionId: string; key: string; value: string }> = []
) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const insertValues = vi.fn().mockReturnValueOnce({ onConflictDoNothing })
  insertValues.mockResolvedValue(undefined)
  const lock = vi.fn().mockResolvedValue([])
  const readSecrets = vi.fn().mockResolvedValue(existingSecrets)
  const selectFrom = vi
    .fn()
    .mockReturnValueOnce({ where: () => ({ for: lock }) })
    .mockReturnValue({ where: readSecrets })
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => ({ from: selectFrom })),
  }
  mockTransaction.mockImplementation(async (callback: (innerTx: typeof tx) => unknown) =>
    callback(tx)
  )

  return { deleteWhere, insertValues, lock, readSecrets, tx }
}
