'use client'

import { useMemo } from 'react'
import { useTradingServices } from '@/components/trading-selector/services'
import { usePortfolioIdentities } from '@/hooks/queries/trading-portfolio'
import {
  arePortfolioIdentitiesEqual,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'

export function usePortfolioIdentitySelection({
  providerId,
  serviceId,
  portfolioIdentity,
  enabled,
}: {
  providerId?: string | null
  serviceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
  enabled: boolean
}) {
  const selectedPortfolioIdentity = useMemo(
    () => toPortfolioValueObject(portfolioIdentity),
    [portfolioIdentity]
  )
  const requestedServiceId = serviceId ?? selectedPortfolioIdentity?.serviceId
  const services = useTradingServices({
    providerId,
    serviceId: requestedServiceId,
    enabled,
  })
  const activeServiceId = enabled ? services.activeServiceId : undefined
  const accountsQuery = usePortfolioIdentities({
    provider: enabled ? (providerId ?? undefined) : undefined,
    serviceId: activeServiceId,
    enabled: enabled && Boolean(activeServiceId),
  })
  const portfolioIdentities = accountsQuery.data ?? []
  const hasResolvedPortfolioIdentities =
    accountsQuery.data !== undefined && !accountsQuery.isLoading && !accountsQuery.error
  const resolvedPortfolioIdentity =
    selectedPortfolioIdentity && hasResolvedPortfolioIdentities
      ? (portfolioIdentities.find((identity) =>
          arePortfolioIdentitiesEqual(identity, selectedPortfolioIdentity)
        ) ?? null)
      : null
  const activePortfolioIdentity = activeServiceId
    ? (resolvedPortfolioIdentity ?? undefined)
    : undefined

  return {
    accountsQuery,
    activeServiceId,
    activePortfolioIdentity,
    services,
    portfolioIdentities,
  }
}
