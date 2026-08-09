'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EnterprisePlaceholderDisplay } from '@/lib/billing/public-catalog'
import type { SubscriptionTierDisplay } from '@/lib/billing/subscription-tier-display'
import { subscriptionKeys } from '@/hooks/queries/subscription'

export interface PrivateTierAccessResponse {
  privateTiers: SubscriptionTierDisplay[]
  enterpriseContactCard: EnterprisePlaceholderDisplay | null
}

export const privateTierAccessKeys = {
  all: ['private-tier-access'] as const,
  current: () => [...privateTierAccessKeys.all, 'current'] as const,
}

async function requestPrivateTierAccess(init?: RequestInit): Promise<PrivateTierAccessResponse> {
  const response = await fetch('/api/billing/private-tier-access', init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Private tier access request failed')
  return data
}

export function usePrivateTierAccess(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: privateTierAccessKeys.current(),
    queryFn: () => requestPrivateTierAccess(),
    enabled: options.enabled ?? true,
  })
  const validateAccessCode = useMutation({
    mutationFn: (accessCode: string) =>
      requestPrivateTierAccess({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: privateTierAccessKeys.current() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.user() }),
      ])
    },
  })
  return { ...query, validateAccessCode }
}
