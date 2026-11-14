import { beforeEach, vi } from 'vitest'
import { getSystemServiceDefinitions } from '@/lib/system-services/catalog'

type Values = Record<string, string | number | boolean>

const state = vi.hoisted(() => ({
  settings: {} as Record<string, Values>,
  credentials: {} as Record<string, Values>,
  readSettings: vi.fn(),
  readConfig: vi.fn(),
  listServices: vi.fn(),
}))

export const managedServices = state

vi.mock('@/lib/system-services/service', () => ({
  resolveSystemServiceSettingsConfig: state.readSettings,
  resolveSystemServiceConfig: state.readConfig,
  listSystemServices: state.listServices,
}))

function resetManagedServices() {
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
  managedServices.readConfig.mockReset().mockImplementation(async (id: string) => ({
    ...managedServices.settings[id],
    ...managedServices.credentials[id],
  }))
}

resetManagedServices()
beforeEach(resetManagedServices)
