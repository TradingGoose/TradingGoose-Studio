import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ServiceKeysQuery')

export type ServiceKeyKind = 'copilot' | 'market'

export interface ServiceApiKey {
  id: string
  displayKey: string
}

export interface GenerateServiceKeyResponse {
  success: boolean
  key: {
    id: string
    apiKey: string
  }
}

const SERVICE_LABELS: Record<ServiceKeyKind, string> = {
  copilot: 'Copilot',
  market: 'Market',
}

const SERVICE_API_PATHS: Record<ServiceKeyKind, string> = {
  copilot: '/api/copilot/api-keys',
  market: '/api/market/api-keys',
}

export const serviceKeysKeys = {
  all: ['serviceKeys'] as const,
  keys: (service: ServiceKeyKind) => [...serviceKeysKeys.all, service, 'api-keys'] as const,
}

async function fetchServiceKeys(service: ServiceKeyKind): Promise<ServiceApiKey[]> {
  const response = await fetch(SERVICE_API_PATHS[service])

  if (!response.ok) {
    throw new Error(`Failed to fetch ${SERVICE_LABELS[service]} API keys`)
  }

  const data = await response.json()
  return data.keys || []
}

export function useServiceKeys(service: ServiceKeyKind) {
  return useQuery({
    queryKey: serviceKeysKeys.keys(service),
    queryFn: () => fetchServiceKeys(service),
    enabled: isHosted,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useGenerateServiceKey(service: ServiceKeyKind) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<GenerateServiceKeyResponse> => {
      const response = await fetch(`${SERVICE_API_PATHS[service]}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `Failed to generate ${SERVICE_LABELS[service]} API key`)
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: serviceKeysKeys.keys(service),
        type: 'active',
      })
    },
    onError: (error) => {
      logger.error(`Failed to generate ${SERVICE_LABELS[service]} API key`, error)
    },
  })
}

interface DeleteKeyParams {
  keyId: string
}

export function useDeleteServiceKey(service: ServiceKeyKind) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ keyId }: DeleteKeyParams) => {
      const response = await fetch(`${SERVICE_API_PATHS[service]}?id=${keyId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `Failed to delete ${SERVICE_LABELS[service]} API key`)
      }

      return response.json()
    },
    onMutate: async ({ keyId }) => {
      await queryClient.cancelQueries({ queryKey: serviceKeysKeys.keys(service) })

      const previousKeys = queryClient.getQueryData<ServiceApiKey[]>(serviceKeysKeys.keys(service))

      queryClient.setQueryData<ServiceApiKey[]>(serviceKeysKeys.keys(service), (old) => {
        return old?.filter((key) => key.id !== keyId) || []
      })

      return { previousKeys }
    },
    onError: (error, _variables, context) => {
      if (context?.previousKeys) {
        queryClient.setQueryData(serviceKeysKeys.keys(service), context.previousKeys)
      }

      logger.error(`Failed to delete ${SERVICE_LABELS[service]} API key`, error)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeysKeys.keys(service) })
    },
  })
}
