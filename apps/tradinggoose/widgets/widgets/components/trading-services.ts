'use client'

import { getServiceByProviderAndId } from '@/lib/oauth'
import { useOAuthConnections } from '@/hooks/queries/oauth-connections'
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
  enabled = true,
}: {
  providerId?: string | null
  serviceId?: string | null
  enabled?: boolean
}): TradingServiceState {
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const serviceIds = providerDefinition
    ? getTradingProviderOAuthServiceIds(providerDefinition.id)
    : []
  const connectionsQuery = useOAuthConnections()
  const connectedServiceIds = serviceIds.filter((serviceId) =>
    (connectionsQuery.data ?? []).some(
      (service) => service.providerId === serviceId && service.isConnected
    )
  )
  const activeServiceId = resolveActiveTradingServiceId({
    serviceId,
    connectedServiceIds,
  })

  return {
    serviceIds,
    connectedServiceIds,
    activeServiceId,
    isLoading: enabled && Boolean(trimmedProviderId) ? connectionsQuery.isLoading : false,
    error: connectionsQuery.error instanceof Error ? connectionsQuery.error : null,
    refetch: () => {
      void connectionsQuery.refetch()
    },
  }
}

export function getTradingServiceName(providerId: string, serviceId: string) {
  return getServiceByProviderAndId(providerId, serviceId).name
}
