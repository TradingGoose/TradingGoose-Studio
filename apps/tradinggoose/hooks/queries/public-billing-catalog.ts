import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PublicBillingCatalog } from '@/lib/billing/public-catalog'

const PUBLIC_BILLING_CATALOG_ENDPOINT = '/api/billing/public-catalog'

export const publicBillingCatalogKeys = {
  all: ['public-billing-catalog'] as const,
  current: () => [...publicBillingCatalogKeys.all, 'current'] as const,
}

async function fetchPublicBillingCatalog(): Promise<PublicBillingCatalog> {
  const response = await fetch(PUBLIC_BILLING_CATALOG_ENDPOINT, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Failed to load billing catalog')
  }

  return response.json()
}

export function usePublicBillingCatalog() {
  return useQuery({
    queryKey: publicBillingCatalogKeys.current(),
    queryFn: fetchPublicBillingCatalog,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}
