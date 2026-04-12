import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminIntegrationDefinition,
  AdminIntegrationSecret,
  AdminIntegrationsSnapshot,
} from '@/lib/admin/integrations/types'

const ADMIN_INTEGRATIONS_ENDPOINT = '/api/admin/integrations'

export const adminIntegrationsKeys = {
  all: ['admin-integrations'] as const,
  snapshot: () => [...adminIntegrationsKeys.all, 'snapshot'] as const,
}

async function parseResponse(response: Response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function normalizeSnapshot(payload: unknown): AdminIntegrationsSnapshot {
  if (!payload || typeof payload !== 'object') {
    return {
      definitions: [],
      secrets: [],
    }
  }

  const data = payload as Record<string, unknown>

  return {
    definitions: Array.isArray(data.definitions)
      ? data.definitions.map((definition) => {
          const item =
            definition && typeof definition === 'object'
              ? (definition as Record<string, unknown>)
              : {}

          return {
            id: typeof item.id === 'string' ? item.id : '',
            parentId: typeof item.parentId === 'string' ? item.parentId : null,
            displayName: typeof item.displayName === 'string' ? item.displayName : '',
            isEnabled: typeof item.isEnabled === 'boolean' ? item.isEnabled : null,
          }
        })
      : [],
    secrets: Array.isArray(data.secrets)
      ? data.secrets.map((secret) => {
          const item =
            secret && typeof secret === 'object' ? (secret as Record<string, unknown>) : {}

          return {
            id: typeof item.id === 'string' ? item.id : '',
            definitionId: typeof item.definitionId === 'string' ? item.definitionId : '',
            credentialKey: typeof item.credentialKey === 'string' ? item.credentialKey : '',
            value: '',
            hasValue: typeof item.hasValue === 'boolean' ? item.hasValue : false,
          }
        })
      : [],
  }
}

async function fetchAdminIntegrationsSnapshot(): Promise<AdminIntegrationsSnapshot> {
  const response = await fetch(ADMIN_INTEGRATIONS_ENDPOINT, {
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await parseResponse(response)
    const message =
      typeof payload === 'object' && payload && 'error' in payload
        ? String(payload.error)
        : 'Failed to load admin integrations'

    throw new Error(message)
  }

  return normalizeSnapshot(await parseResponse(response))
}

export function useAdminIntegrationsSnapshot() {
  return useQuery({
    queryKey: adminIntegrationsKeys.snapshot(),
    queryFn: fetchAdminIntegrationsSnapshot,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useSaveAdminIntegrationBundle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      bundleId,
      definition,
      services,
      secrets,
    }: {
      bundleId: string
      definition: AdminIntegrationDefinition
      services: AdminIntegrationDefinition[]
      secrets: AdminIntegrationSecret[]
    }): Promise<AdminIntegrationsSnapshot> => {
      const response = await fetch(ADMIN_INTEGRATIONS_ENDPOINT, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bundleId,
          definition,
          services,
          secrets,
        }),
      })

      if (!response.ok) {
        const payload = await parseResponse(response)
        const message =
          typeof payload === 'object' && payload && 'error' in payload
            ? String(payload.error)
            : 'Failed to save admin integrations'

        throw new Error(message)
      }

      return normalizeSnapshot(await parseResponse(response))
    },
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(adminIntegrationsKeys.snapshot(), snapshot)
    },
  })
}
