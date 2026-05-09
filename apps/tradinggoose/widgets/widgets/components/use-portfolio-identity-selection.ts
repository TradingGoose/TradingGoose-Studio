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
  const credentialServices = useTradingCredentialServices({
    providerId,
    credentialServiceId: credentialServiceId ?? selectedPortfolioIdentity?.credentialServiceId,
    enabled,
  })
  const activeCredentialServiceId = enabled
    ? (selectedPortfolioIdentity?.credentialServiceId ?? credentialServices.activeServiceId)
    : undefined
  const accountsQuery = usePortfolioIdentities({
    workspaceId: workspaceId ?? undefined,
    provider: enabled ? (providerId ?? undefined) : undefined,
    credentialServiceId: activeCredentialServiceId,
    enabled: enabled && Boolean(activeCredentialServiceId),
  })
  const portfolioIdentities = accountsQuery.data ?? []
  const singlePortfolioIdentity =
    portfolioIdentities.length === 1 ? (portfolioIdentities[0] ?? null) : null
  const selectedPortfolioAccount =
    selectedPortfolioIdentity && !accountsQuery.isLoading && !accountsQuery.error
      ? (portfolioIdentities.find((identity) =>
          arePortfolioIdentitiesEqual(identity, selectedPortfolioIdentity)
        ) ?? null)
      : !selectedPortfolioIdentity
        ? singlePortfolioIdentity
        : null
  const activePortfolioIdentity = activeCredentialServiceId
    ? selectedPortfolioIdentity ?? singlePortfolioIdentity ?? undefined
    : undefined

  useEffect(() => {
    if (!enabled || accountsQuery.isLoading || accountsQuery.error) return
    if (selectedPortfolioIdentity || portfolioIdentities.length !== 1) return

    const onlyAccount = portfolioIdentities[0]
    if (!onlyAccount) return
    emitParamsChange({
      params: {
        credentialServiceId: activeCredentialServiceId,
        portfolioIdentity: onlyAccount,
      },
      panelId,
      widgetKey,
    })
  }, [
    accountsQuery.error,
    accountsQuery.isLoading,
    activeCredentialServiceId,
    emitParamsChange,
    enabled,
    panelId,
    portfolioIdentities,
    selectedPortfolioIdentity,
    widgetKey,
  ])

  useEffect(() => {
    if (!enabled || accountsQuery.isLoading || accountsQuery.error || !selectedPortfolioIdentity) {
      return
    }
    if (
      portfolioIdentities.some((identity) =>
        arePortfolioIdentitiesEqual(identity, selectedPortfolioIdentity)
      )
    ) {
      return
    }
    emitParamsChange({
      params: {
        portfolioIdentity: null,
      },
      panelId,
      widgetKey,
    })
  }, [
    accountsQuery.error,
    accountsQuery.isLoading,
    emitParamsChange,
    enabled,
    panelId,
    portfolioIdentities,
    selectedPortfolioIdentity,
    widgetKey,
  ])

  return {
    accountsQuery,
    activeCredentialServiceId,
    activePortfolioIdentity,
    credentialServices,
    portfolioIdentities,
    selectedPortfolioAccount,
    selectedPortfolioIdentity,
  }
}
