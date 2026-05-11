'use client'

import { getServiceByProviderAndId } from '@/lib/oauth'
import { useOAuthCredentialsByProviderIds } from '@/hooks/queries/oauth-credentials'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceIds,
} from '@/providers/trading/providers'

export type TradingCredentialServiceState = {
  serviceIds: string[]
  connectedServiceIds: string[]
  activeServiceId?: string
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function resolveActiveTradingCredentialServiceId({
  credentialServiceId,
  connectedServiceIds,
}: {
  credentialServiceId?: string | null
  connectedServiceIds: string[]
}) {
  const requestedServiceId =
    typeof credentialServiceId === 'string' ? credentialServiceId.trim() : ''
  if (requestedServiceId && connectedServiceIds.includes(requestedServiceId)) {
    return requestedServiceId
  }
  return connectedServiceIds.length === 1 ? connectedServiceIds[0] : undefined
}

export function useTradingCredentialServices({
  providerId,
  credentialServiceId,
  enabled = true,
}: {
  providerId?: string | null
  credentialServiceId?: string | null
  enabled?: boolean
}): TradingCredentialServiceState {
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const serviceIds = providerDefinition
    ? getTradingProviderOAuthServiceIds(providerDefinition.id)
    : []
  const credentialsQuery = useOAuthCredentialsByProviderIds(
    serviceIds,
    enabled && Boolean(trimmedProviderId)
  )
  const credentialsByProviderId = credentialsQuery.data ?? {}
  const connectedServiceIds = serviceIds.filter(
    (serviceId) => (credentialsByProviderId[serviceId]?.length ?? 0) > 0
  )
  const activeServiceId = resolveActiveTradingCredentialServiceId({
    credentialServiceId,
    connectedServiceIds,
  })

  return {
    serviceIds,
    connectedServiceIds,
    activeServiceId,
    isLoading: credentialsQuery.isLoading,
    error: credentialsQuery.error instanceof Error ? credentialsQuery.error : null,
    refetch: () => {
      void credentialsQuery.refetch()
    },
  }
}

export function getTradingCredentialServiceName(providerId: string, serviceId: string) {
  return getServiceByProviderAndId(providerId, serviceId).name
}
