/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockListSystemServices,
  mockUpsertSystemServiceConfig,
  mockModelProviders,
  mockResolvedSettings,
} = vi.hoisted(() => ({
  mockListSystemServices: vi.fn(),
  mockUpsertSystemServiceConfig: vi.fn(),
  mockModelProviders: vi.fn(),
  mockResolvedSettings: vi.fn(),
}))

vi.mock('@/lib/mastra/registry', () => ({
  getModelProviders: async () => mockModelProviders(),
}))
vi.mock('@mastra/core/llm', () => ({
  GatewayRegistry: {
    getInstance: () => ({
      getProviders: () =>
        Object.fromEntries(
          mockModelProviders().map(({ id, name }: { id: string; name: string }) => [
            id,
            { name, models: [] },
          ])
        ),
    }),
  },
}))
vi.mock('@/lib/system-settings/service', () => ({
  getCopilotSettings: async () => (await mockResolvedSettings()).copilot,
}))

vi.mock('@/lib/system-services/service', () => ({
  listSystemServices: (...args: any[]) => mockListSystemServices(...args),
  upsertSystemServiceConfig: (...args: any[]) => mockUpsertSystemServiceConfig(...args),
  SystemServiceValidationError: class SystemServiceValidationError extends Error {},
}))

describe('admin system services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockListSystemServices.mockResolvedValue([])
    mockResolvedSettings.mockResolvedValue({ copilot: { models: [] } })
    mockModelProviders.mockReturnValue([
      { id: 'openai', name: 'OpenAI' },
      { id: 'mistral', name: 'Mistral' },
      { id: 'fireworks', name: 'Fireworks' },
      { id: 'azure-openai', name: 'Azure OpenAI' },
      { id: 'openrouter', name: 'OpenRouter' },
    ])
  })

  it('marks optional Market API and Local Execution fields as non-blocking', async () => {
    const { listAdminSystemServices } = await import('./system-services')

    const snapshot = await listAdminSystemServices()

    const github = snapshot.services.find((service) => service.id === 'github')
    const marketApi = snapshot.services.find((service) => service.id === 'market_api')
    const localExecution = snapshot.services.find((service) => service.id === 'local_execution')

    expect(github?.settings.find((setting) => setting.key === 'blogRepository')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: 'TradingGoose/TradingGoose-Blog',
    })
    expect(github?.settings.find((setting) => setting.key === 'blogBranch')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: 'main',
    })
    expect(marketApi?.credentials.find((credential) => credential.key === 'apiKey')).toMatchObject({
      required: false,
      hasValue: false,
    })
    expect(marketApi?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: true,
      defaultValue: 'https://market.tradinggoose.ai',
    })
    expect(
      localExecution?.settings.find((setting) => setting.key === 'maxConcurrentExecutions')
    ).toMatchObject({
      required: true,
      defaultValue: '200',
    })
    expect(
      localExecution?.settings.find((setting) => setting.key === 'maxActivePerOwner')
    ).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: '',
    })
  })

  it('uses native provider identities and managed connection settings without retired adapters', async () => {
    mockResolvedSettings.mockResolvedValue({
      copilot: {
        models: [
          { provider: 'fireworks', model: 'future-model' },
          { provider: 'azure-openai', model: 'deployment' },
        ],
      },
    })
    const { listAdminSystemServices } = await import('./system-services')
    const { getSystemServiceDefinition, isSystemServiceSettingKey } = await import(
      '@/lib/system-services/catalog'
    )
    const snapshot = await listAdminSystemServices()
    expect(snapshot.services.some(({ id }) => id === 'fireworks')).toBe(true)
    expect(snapshot.services.some(({ id }) => id === 'azure-openai')).toBe(false)
    expect(snapshot.services.some(({ id }) => id === 'azure_openai')).toBe(true)
    expect(isSystemServiceSettingKey('azure_openai', 'resourceName')).toBe(true)
    expect(isSystemServiceSettingKey('ollama', 'baseUrl')).toBe(true)
    expect(isSystemServiceSettingKey('fireworks', 'baseUrl')).toBe(false)
    for (const id of ['openai', 'mistral'])
      expect(snapshot.services.filter((service) => service.id === id)).toHaveLength(1)
  })

  it('masks saved credentials for selected providers without exposing their stored values', async () => {
    const { listAdminSystemServices } = await import('./system-services')
    const { getModelProviders } = await import('@/lib/mastra/registry')
    const { getSystemServiceDefinition } = await import('@/lib/system-services/catalog')
    mockResolvedSettings.mockResolvedValue({
      copilot: {
        models: (await getModelProviders()).map(({ id }) => ({
          provider: id,
          model: 'selected-model',
        })),
      },
    })
    mockListSystemServices.mockResolvedValue([
      {
        id: 'openrouter',
        credentials: [{ key: 'apiKey', hasValue: true, value: 'stored-private-value' }],
        settings: [],
      },
    ])
    const snapshot = await listAdminSystemServices()
    expect(JSON.stringify(snapshot)).not.toContain('stored-private-value')

    for (const { id } of await getModelProviders()) {
      const serviceId = id === 'azure-openai' ? 'azure_openai' : id
      const service = snapshot.services.find((candidate) => candidate.id === serviceId)
      expect(service?.credentials).toContainEqual(
        expect.objectContaining({
          key: getSystemServiceDefinition(serviceId)!.credentialFields[0].key,
          value: '',
          hasValue: id === 'openrouter',
        })
      )
    }
  })
  it('includes newly available native providers on the next settings read', async () => {
    const { listAdminSystemServices } = await import('./system-services')
    expect(
      (await listAdminSystemServices()).services.some(({ id }) => id === 'new-native-provider')
    ).toBe(false)
    mockModelProviders.mockReturnValue([{ id: 'new-native-provider', name: 'New Native Provider' }])
    mockResolvedSettings.mockResolvedValue({
      copilot: {
        models: [{ provider: 'new-native-provider', model: 'future-model' }],
      },
    })
    const service = (await listAdminSystemServices()).services.find(
      ({ id }) => id === 'new-native-provider'
    )
    expect(service).toMatchObject({
      displayName: 'New Native Provider',
      credentials: [{ key: 'apiKey', value: '', hasValue: false }],
    })
  })
  it('shows only base services when no Copilot providers are selected', async () => {
    const { listAdminSystemServices } = await import('./system-services')
    const { SYSTEM_SERVICE_DEFINITIONS } = await import('@/lib/system-services/catalog')
    const snapshot = await listAdminSystemServices()
    expect(snapshot.services.map(({ id }) => id)).toEqual(
      SYSTEM_SERVICE_DEFINITIONS.map(({ id }) => id)
    )
    expect(snapshot.services.find(({ id }) => id === 'openai')?.credentials[0].key).toBe(
      'defaultApiKey'
    )
    expect(snapshot.services.find(({ id }) => id === 'mistral')?.credentials[0].key).toBe('apiKey')
  })

  it('deduplicates selected gateway models and hides deselected providers on the next read without deleting keys', async () => {
    const { listAdminSystemServices } = await import('./system-services')
    const selected = {
      copilot: {
        models: [
          { provider: 'openrouter', model: 'vendor/first-model' },
          { provider: 'openrouter', model: 'vendor/second-model' },
        ],
      },
    }
    mockResolvedSettings.mockResolvedValue(selected)
    mockListSystemServices.mockResolvedValue([
      { id: 'openrouter', credentials: [{ key: 'apiKey', hasValue: true }], settings: [] },
    ])
    const first = await listAdminSystemServices()
    expect(first.services.filter(({ id }) => id === 'openrouter')).toHaveLength(1)
    expect(first.services.some(({ id }) => id === 'fireworks')).toBe(false)
    mockResolvedSettings.mockResolvedValue({ copilot: { models: [] } })
    expect((await listAdminSystemServices()).services.some(({ id }) => id === 'openrouter')).toBe(
      false
    )
    mockResolvedSettings.mockResolvedValue(selected)
    expect(
      (await listAdminSystemServices()).services.find(({ id }) => id === 'openrouter')
        ?.credentials[0]
    ).toMatchObject({ value: '', hasValue: true })
    expect(mockUpsertSystemServiceConfig).not.toHaveBeenCalled()
  })
})
