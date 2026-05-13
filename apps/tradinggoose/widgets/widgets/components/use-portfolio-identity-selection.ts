'use client'

import { useEffect, useMemo } from 'react'
import { usePortfolioIdentities } from '@/hooks/queries/trading-portfolio'
import {
  arePortfolioIdentitiesEqual,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import { useTradingServices } from '@/widgets/widgets/components/trading-services'

type EmitPortfolioParamsChange = (input: {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}) => void

export function usePortfolioIdentitySelection({
  workspaceId,
  providerId,
  serviceId,
  portfolioIdentity,
  enabled,
  panelId,
  widgetKey,
  emitParamsChange,
}: {
  workspaceId?: string | null
  providerId?: string | null
  serviceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
  enabled: boolean
  panelId?: string
  widgetKey: string
  emitParamsChange: EmitPortfolioParamsChange
}) {
  const selectedPortfolioIdentity = useMemo(
    () => toPortfolioValueObject(portfolioIdentity),
    [portfolioIdentity]
  )
  const hasSelectedPortfolioIdentity = portfolioIdentity !== undefined && portfolioIdentity !== null
  const requestedServiceId = serviceId ?? selectedPortfolioIdentity?.serviceId
  const services = useTradingServices({
    providerId,
    serviceId: requestedServiceId,
    workspaceId,
    enabled,
  })
  const activeServiceId = enabled ? services.activeServiceId : undefined
  const accountsQuery = usePortfolioIdentities({
    workspaceId: workspaceId ?? undefined,
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

  useEffect(() => {
    if (!enabled || !hasResolvedPortfolioIdentities) return
    if (!activeServiceId) return
    if (selectedPortfolioIdentity && resolvedPortfolioIdentity) return
    if (!hasSelectedPortfolioIdentity) return

    emitParamsChange({
      params: {
        serviceId: activeServiceId,
        portfolioIdentity: null,
      },
      panelId,
      widgetKey,
    })
  }, [
    activeServiceId,
    emitParamsChange,
    enabled,
    hasResolvedPortfolioIdentities,
    hasSelectedPortfolioIdentity,
    panelId,
    resolvedPortfolioIdentity,
    selectedPortfolioIdentity,
    widgetKey,
  ])

  return {
    accountsQuery,
    activeServiceId,
    activePortfolioIdentity,
    services,
    portfolioIdentities,
  }
}
