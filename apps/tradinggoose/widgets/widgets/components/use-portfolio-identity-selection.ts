'use client'

import { useEffect, useMemo } from 'react'
import { usePortfolioIdentities } from '@/hooks/queries/trading-portfolio'
import {
  arePortfolioIdentitiesEqual,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import { useTradingCredentialServices } from '@/widgets/widgets/components/trading-credential-services'

type EmitPortfolioParamsChange = (input: {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}) => void

export function usePortfolioIdentitySelection({
  workspaceId,
  providerId,
  credentialServiceId,
  portfolioIdentity,
  enabled,
  panelId,
  widgetKey,
  emitParamsChange,
}: {
  workspaceId?: string | null
  providerId?: string | null
  credentialServiceId?: string | null
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
  const requestedCredentialServiceId =
    credentialServiceId ?? selectedPortfolioIdentity?.credentialServiceId
  const credentialServices = useTradingCredentialServices({
    providerId,
    credentialServiceId: requestedCredentialServiceId,
    enabled,
  })
  const activeCredentialServiceId = enabled ? credentialServices.activeServiceId : undefined
  const accountsQuery = usePortfolioIdentities({
    workspaceId: workspaceId ?? undefined,
    provider: enabled ? (providerId ?? undefined) : undefined,
    credentialServiceId: activeCredentialServiceId,
    enabled: enabled && Boolean(activeCredentialServiceId),
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
  const activePortfolioIdentity = activeCredentialServiceId
    ? (resolvedPortfolioIdentity ?? undefined)
    : undefined

  useEffect(() => {
    if (!enabled || !hasResolvedPortfolioIdentities) return
    if (!activeCredentialServiceId) return
    if (selectedPortfolioIdentity && resolvedPortfolioIdentity) return
    if (!hasSelectedPortfolioIdentity) return

    emitParamsChange({
      params: {
        credentialServiceId: activeCredentialServiceId,
        portfolioIdentity: null,
      },
      panelId,
      widgetKey,
    })
  }, [
    activeCredentialServiceId,
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
    activeCredentialServiceId,
    activePortfolioIdentity,
    credentialServices,
    portfolioIdentities,
  }
}
