import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'

const PRIVATE_TIER_ACCESS_ENDPOINT = '/api/billing/private-tier-access'

export interface PrivateTierAccessResponse {
  privateTiers: PublicBillingTierDisplay[]
}

export const privateTierAccessKeys = {
  all: ['private-tier-access'] as const,
  current: () => [...privateTierAccessKeys.all, 'current'] as const,
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : 'Private tier access request failed'
    throw new Error(message)
  }

  return payload as PrivateTierAccessResponse
}

async function fetchPrivateTierAccess() {
  return parseResponse(await fetch(PRIVATE_TIER_ACCESS_ENDPOINT))
}

async function requestPrivateTierAccess(accessCode: string) {
  return parseResponse(
    await fetch(PRIVATE_TIER_ACCESS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode }),
    })
  )
}

export function usePrivateTierAccess() {
  return useQuery({
    queryKey: privateTierAccessKeys.current(),
    queryFn: fetchPrivateTierAccess,
    staleTime: 30 * 1000,
  })
}

export function usePrivateTierAccessMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: requestPrivateTierAccess,
    onSuccess: (response) => {
      queryClient.setQueryData(privateTierAccessKeys.current(), response)
    },
  })
}
