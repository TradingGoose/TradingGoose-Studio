import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  useQuery,
} from '@tanstack/react-query'
import { monetary } from '@tradinggoose/billing/money'

/**
 * Query key factories for subscription-related queries
 */
export const subscriptionKeys = {
  all: ['subscription'] as const,
  user: () => [...subscriptionKeys.all, 'user'] as const,
  usage: () => [...subscriptionKeys.all, 'usage'] as const,
}

/**
 * Fetch user subscription data
 */
async function fetchSubscriptionData() {
  const response = await fetch('/api/billing?context=user')
  if (!response.ok) {
    throw new Error('Failed to fetch subscription data')
  }
  return response.json()
}

/**
 * Hook to fetch user subscription data
 */
export function useSubscriptionData() {
  return useQuery({
    queryKey: subscriptionKeys.user(),
    queryFn: fetchSubscriptionData,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch user usage limit metadata
 * Note: This endpoint returns limit information (currentLimit, minimumLimit, canEdit, etc.)
 * For actual usage data (current, limit, percentUsed), use useSubscriptionData() instead
 */
async function fetchUsageLimitData() {
  const response = await fetch('/api/usage?context=user')
  if (!response.ok) {
    throw new Error('Failed to fetch usage limit data')
  }
  return response.json()
}

/**
 * Hook to fetch usage limit metadata
 * Returns: currentLimit, minimumLimit, canEdit, tier, updatedAt
 * Use this for editing usage limits, not for displaying current usage
 */
export function useUsageLimitData() {
  return useQuery({
    queryKey: subscriptionKeys.usage(),
    queryFn: fetchUsageLimitData,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Update usage limit mutation
 */
interface UpdateUsageLimitParams {
  limit: string
}

export const subscriptionMutationOptions = {
  updateUsageLimit(queryClient: QueryClient) {
    return mutationOptions({
      mutationFn: async ({ limit }: UpdateUsageLimitParams) => {
        const response = await fetch('/api/usage?context=user', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: monetary(limit) }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || error.message || 'Failed to update usage limit')
        }

        return response.json()
      },
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.user() }),
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.usage() }),
        ]),
    })
  },
}
