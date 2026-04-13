/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListSystemServices, mockUpsertSystemServiceConfig } = vi.hoisted(() => ({
  mockListSystemServices: vi.fn(),
  mockUpsertSystemServiceConfig: vi.fn(),
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
  })

  it('marks optional Market API and Local Execution fields as non-blocking', async () => {
    const { listAdminSystemServices } = await import('./system-services')

    const snapshot = await listAdminSystemServices()

    const marketApi = snapshot.services.find((service) => service.id === 'market_api')
    const localExecution = snapshot.services.find((service) => service.id === 'local_execution')
    const ollama = snapshot.services.find((service) => service.id === 'ollama')

    expect(marketApi?.credentials.find((credential) => credential.key === 'apiKey')).toMatchObject({
      required: false,
      hasValue: false,
    })
    expect(marketApi?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: true,
      defaultValue: 'https://market.tradinggoose.ai',
    })
    expect(localExecution?.settings.find((setting) => setting.key === 'maxConcurrentExecutions')).toMatchObject({
      required: true,
      defaultValue: '200',
    })
    expect(localExecution?.settings.find((setting) => setting.key === 'maxActivePerOwner')).toMatchObject({
      required: false,
      hasValue: false,
      defaultValue: '',
    })
    expect(ollama?.settings.find((setting) => setting.key === 'baseUrl')).toMatchObject({
      required: true,
      defaultValue: 'http://localhost:11434',
    })
  })
})
