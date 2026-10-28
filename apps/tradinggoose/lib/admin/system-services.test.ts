/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListSystemServices, mockUpsertSystemServiceConfig, environment } = vi.hoisted(() => ({
  mockListSystemServices: vi.fn(),
  mockUpsertSystemServiceConfig: vi.fn(),
  environment: { isHosted: false },
}))

vi.mock('@/lib/environment', () => environment)

vi.mock('@/lib/system-services/service', () => ({
  listSystemServices: (...args: any[]) => mockListSystemServices(...args),
  upsertSystemServiceConfig: (...args: any[]) => mockUpsertSystemServiceConfig(...args),
  SystemServiceValidationError: class SystemServiceValidationError extends Error {},
}))

describe('admin system services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    environment.isHosted = false
    mockListSystemServices.mockResolvedValue([])
  })

  it('marks optional Market API and Local Execution fields as non-blocking', async () => {
    const { listAdminSystemServices } = await import('./system-services')

    const snapshot = await listAdminSystemServices()

    const github = snapshot.services.find((service) => service.id === 'github')
    const marketApi = snapshot.services.find((service) => service.id === 'market_api')
    const localExecution = snapshot.services.find((service) => service.id === 'local_execution')
    const ollama = snapshot.services.find((service) => service.id === 'ollama')

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
    expect(ollama?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: true,
      defaultValue: 'http://localhost:11434',
    })
  })

  it('removes Ollama from hosted settings and configuration lookups', async () => {
    environment.isHosted = true
    const { listAdminSystemServices } = await import('./system-services')
    const { getSystemServiceDefinition, isSystemServiceSettingKey } = await import(
      '@/lib/system-services/catalog'
    )

    const snapshot = await listAdminSystemServices()

    expect(snapshot.services.some((service) => service.id === 'ollama')).toBe(false)
    expect(getSystemServiceDefinition('ollama')).toBeNull()
    expect(isSystemServiceSettingKey('ollama', 'baseUrl')).toBe(false)
    expect(snapshot.services.some((service) => service.id === 'openai')).toBe(true)
  })
})
