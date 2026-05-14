'use client'

import { getServiceByProviderAndId } from '@/lib/oauth'
import { useOAuthCredentialsByProviderIds } from '@/hooks/queries/oauth-credentials'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceIds,
} from '@/providers/trading/providers'

export type TradingServiceState = {
  serviceIds: string[]
  connectedServiceIds: string[]
  activeServiceId?: string
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function resolveActiveTradingServiceId({
  serviceId,
  connectedServiceIds,
}: {
  serviceId?: string | null
  connectedServiceIds: string[]
}) {
  const requestedServiceId = typeof serviceId === 'string' ? serviceId.trim() : ''
  if (requestedServiceId && connectedServiceIds.includes(requestedServiceId)) {
    return requestedServiceId
  }
  return connectedServiceIds.length === 1 ? connectedServiceIds[0] : undefined
}

export function useTradingServices({
  providerId,
  serviceId,
  workspaceId,
  enabled = true,
}: {
  providerId?: string | null
  serviceId?: string | null
  workspaceId?: string | null
  enabled?: boolean
}): TradingServiceState {
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const trimmedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const serviceIds = providerDefinition
    ? getTradingProviderOAuthServiceIds(providerDefinition.id)
    : []
  const credentialsQuery = useOAuthCredentialsByProviderIds(
    serviceIds,
    enabled && Boolean(trimmedProviderId),
    trimmedWorkspaceId ? { workspaceId: trimmedWorkspaceId } : undefined
  )
  const credentialsByProviderId = credentialsQuery.data ?? {}
  const connectedServiceIds = serviceIds.filter(
    (serviceId) => (credentialsByProviderId[serviceId]?.length ?? 0) > 0
  )
  const activeServiceId = resolveActiveTradingServiceId({
    serviceId,
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

export function getTradingServiceName(providerId: string, serviceId: string) {
  return getServiceByProviderAndId(providerId, serviceId).name
}
