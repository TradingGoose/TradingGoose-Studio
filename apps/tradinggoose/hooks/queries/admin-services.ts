import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminSystemService,
  AdminSystemServicesSnapshot,
} from '@/lib/admin/system-services/types'

const ADMIN_SERVICES_ENDPOINT = '/api/admin/services'

export const adminServicesKeys = {
  all: ['admin-services'] as const,
  snapshot: () => [...adminServicesKeys.all, 'snapshot'] as const,
}

async function parseResponse(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

function normalizeSnapshot(payload: unknown): AdminSystemServicesSnapshot {
  if (!payload || typeof payload !== 'object') {
    return { services: [] }
  }

  const data = payload as Record<string, unknown>

  return {
    services: Array.isArray(data.services)
      ? data.services.map((service) => {
          const item =
            service && typeof service === 'object' ? (service as Record<string, unknown>) : {}
          return {
            id: typeof item.id === 'string' ? item.id : '',
            displayName: typeof item.displayName === 'string' ? item.displayName : '',
            description: typeof item.description === 'string' ? item.description : '',
            credentials: Array.isArray(item.credentials)
              ? item.credentials.map((credential) => {
                  const field =
                    credential && typeof credential === 'object'
                      ? (credential as Record<string, unknown>)
                      : {}
                  return {
                    key: typeof field.key === 'string' ? field.key : '',
                    label: typeof field.label === 'string' ? field.label : '',
                    description: typeof field.description === 'string' ? field.description : '',
                    value: '',
                    hasValue: typeof field.hasValue === 'boolean' ? field.hasValue : false,
                  }
                })
              : [],
            settings: Array.isArray(item.settings)
              ? item.settings.map((setting) => {
                  const field =
                    setting && typeof setting === 'object'
                      ? (setting as Record<string, unknown>)
                      : {}
                  return {
                    key: typeof field.key === 'string' ? field.key : '',
                    label: typeof field.label === 'string' ? field.label : '',
                    description: typeof field.description === 'string' ? field.description : '',
                    type:
                      field.type === 'url' ||
                      field.type === 'number' ||
                      field.type === 'boolean'
                        ? field.type
                        : 'text',
                    value: typeof field.value === 'string' ? field.value : '',
                    hasValue: typeof field.hasValue === 'boolean' ? field.hasValue : false,
                    defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : '',
                  }
                })
              : [],
          } satisfies AdminSystemService
        })
      : [],
  }
}

async function fetchAdminServicesSnapshot(): Promise<AdminSystemServicesSnapshot> {
  const response = await fetch(ADMIN_SERVICES_ENDPOINT, {
    cache: 'no-store',
  })
  const payload = await parseResponse(response)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : 'Failed to load services'
    throw new Error(message)
  }

  return normalizeSnapshot(payload)
}

export function useAdminServicesSnapshot() {
  return useQuery({
    queryKey: adminServicesKeys.snapshot(),
    queryFn: fetchAdminServicesSnapshot,
    staleTime: 30 * 1000,
  })
}

export function useSaveAdminService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      serviceId: string
      credentials: Array<{
        key: string
        value: string
        hasValue: boolean
      }>
      settings: Array<{
        key: string
        value: string
        hasValue: boolean
      }>
    }): Promise<AdminSystemServicesSnapshot> => {
      const response = await fetch(ADMIN_SERVICES_ENDPOINT, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })
      const payload = await parseResponse(response)

      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String(payload.error)
            : 'Failed to save services'
        throw new Error(message)
      }

      return normalizeSnapshot(payload)
    },
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(adminServicesKeys.snapshot(), snapshot)
    },
  })
}
