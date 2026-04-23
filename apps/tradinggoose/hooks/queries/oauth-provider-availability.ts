'use client'

import { useQuery } from '@tanstack/react-query'

export type OAuthProviderAvailability = Record<string, boolean>

const normalizeProviderIds = (providerIds: string[]) =>
  Array.from(new Set(providerIds.map((providerId) => providerId.trim()).filter(Boolean))).sort()

export const oauthProviderAvailabilityKeys = {
  list: (providerIds: string[]) =>
    ['oauthProviderAvailability', ...normalizeProviderIds(providerIds)] as const,
}

export async function fetchOAuthProviderAvailability(
  providerIds: string[]
): Promise<OAuthProviderAvailability> {
  const normalizedProviderIds = normalizeProviderIds(providerIds)
  if (normalizedProviderIds.length === 0) {
    return {}
  }

  const query = `?providers=${encodeURIComponent(normalizedProviderIds.join(','))}`
  const response = await fetch(`/api/auth/oauth/providers${query}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return (await response.json()) as OAuthProviderAvailability
}

export function useOAuthProviderAvailability(providerIds: string[], enabled = true) {
  const normalizedProviderIds = normalizeProviderIds(providerIds)

  return useQuery<OAuthProviderAvailability>({
    queryKey: oauthProviderAvailabilityKeys.list(normalizedProviderIds),
    queryFn: () => fetchOAuthProviderAvailability(normalizedProviderIds),
    enabled: enabled && normalizedProviderIds.length > 0,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
