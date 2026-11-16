import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  useQuery,
} from '@tanstack/react-query'
import { isHosted } from '@/lib/environment'

export interface MarketApiKey {
  id: string
  displayKey: string
}

interface GenerateMarketKeyResponse {
  success: boolean
  key: {
    id: string
    apiKey: string
  }
}

const marketKeysQueryKey = ['market', 'api-keys'] as const

async function fetchMarketKeys(): Promise<MarketApiKey[]> {
  const response = await fetch('/api/market/api-keys')

  if (!response.ok) {
    throw new Error('Failed to fetch Market API keys')
  }

  const data = await response.json()
  return data.keys || []
}

export function useMarketKeys() {
  return useQuery({
    queryKey: marketKeysQueryKey,
    queryFn: fetchMarketKeys,
    enabled: isHosted,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export const marketKeyMutationOptions = {
  generate(queryClient: QueryClient) {
    return mutationOptions({
      mutationFn: async (): Promise<GenerateMarketKeyResponse> => {
        const response = await fetch('/api/market/api-keys/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to generate Market API key')
        }

        return response.json()
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: marketKeysQueryKey }),
    })
  },

  delete(queryClient: QueryClient) {
    return mutationOptions({
      mutationFn: async ({ keyId }: { keyId: string }) => {
        const response = await fetch(`/api/market/api-keys?id=${keyId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete Market API key')
        }

        return response.json()
      },
      onMutate: async ({ keyId }) => {
        await queryClient.cancelQueries({ queryKey: marketKeysQueryKey })

        const previousKeys = queryClient.getQueryData<MarketApiKey[]>(marketKeysQueryKey)

        queryClient.setQueryData<MarketApiKey[]>(marketKeysQueryKey, (old) => {
          return old?.filter((key) => key.id !== keyId) || []
        })

        return { previousKeys }
      },
      onError: (_error, _variables, context) => {
        if (context?.previousKeys) {
          queryClient.setQueryData(marketKeysQueryKey, context.previousKeys)
        }
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: marketKeysQueryKey }),
    })
  },
}
