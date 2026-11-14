import { beforeEach, vi } from 'vitest'
import { getSystemServiceDefinitions } from '@/lib/system-services/catalog'

type Values = Record<string, string | number | boolean>

const state = vi.hoisted(() => ({
  settings: {} as Record<string, Values>,
  credentials: {} as Record<string, Values>,
  readSettings: vi.fn(),
  readConfig: vi.fn(),
  listServices: vi.fn(),
  decrypt: vi.fn((value: string | number | boolean) => value),
}))

export const managedServices = state

vi.mock('@/lib/system-services/service', () => ({
  resolveSystemServiceSettingsConfig: state.readSettings,
  resolveSystemServiceConfig: state.readConfig,
  listSystemServices: state.listServices,
}))

export function resetManagedServices() {
  managedServices.settings = {}
  managedServices.credentials = {}
  managedServices.listServices.mockReset().mockImplementation(async () =>
    getSystemServiceDefinitions().map((definition) => ({
      id: definition.id,
      credentials: definition.credentialFields.map(({ key }) => ({
        key,
        hasValue: Object.hasOwn(managedServices.credentials[definition.id] ?? {}, key),
      })),
    }))
  )
  managedServices.readSettings.mockReset().mockImplementation(async (id: string) => ({
    ...managedServices.settings[id],
  }))
  managedServices.decrypt.mockClear()
  managedServices.readConfig.mockReset().mockImplementation(async (id: string) => ({
    ...managedServices.settings[id],
    ...Object.fromEntries(
      Object.entries(managedServices.credentials[id] ?? {}).map(([key, value]) => [
        key,
        managedServices.decrypt(value),
      ])
    ),
  }))
}

export function setManagedProviders(providers: Record<string, unknown>) {
  managedServices.settings.mastra_model_providers = { providers: JSON.stringify(providers) }
}

export function setManagedAzure(config: {
  resourceName: string
  deployments: string[]
  apiVersion?: string
  apiKey?: string
}) {
  const { apiKey, deployments, ...settings } = config
  managedServices.settings.azure_openai = {
    ...settings,
    deployments: JSON.stringify(deployments),
  }
  managedServices.credentials.azure_openai = apiKey ? { apiKey } : {}
}

resetManagedServices()
beforeEach(resetManagedServices)
