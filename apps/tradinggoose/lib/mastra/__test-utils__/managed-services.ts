import { beforeEach, vi } from 'vitest'
import { getSystemServiceDefinitions } from '@/lib/system-services/catalog'

type Values = Record<string, string | number | boolean>

const state = vi.hoisted(() => ({
  credentials: {} as Record<string, Values>,
  readConfig: vi.fn(),
  listServices: vi.fn(),
}))

export const managedServices = state

vi.mock('@/lib/system-services/service', () => ({
  resolveSystemServiceConfig: state.readConfig,
  listSystemServices: state.listServices,
}))

function resetManagedServices() {
  managedServices.credentials = {}
  managedServices.listServices.mockReset().mockImplementation(async () =>
    (await getSystemServiceDefinitions()).map((definition) => ({
      id: definition.id,
      credentials: definition.credentialFields.map(({ key }) => ({
        key,
        hasValue: Object.hasOwn(managedServices.credentials[definition.id] ?? {}, key),
      })),
    }))
  )
  managedServices.readConfig.mockReset().mockImplementation(async (id: string) => ({
    ...managedServices.credentials[id],
  }))
}

resetManagedServices()
beforeEach(resetManagedServices)
