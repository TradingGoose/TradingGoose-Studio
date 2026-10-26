'use client'

import { getServiceByProviderAndId } from '@/lib/oauth'
import { useOAuthConnections } from '@/hooks/queries/oauth-connections'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceIds,
} from '@/providers/trading/providers'

export type TradingServiceState = {
  serviceIds: string[]
  connectedServiceIds: string[]
  activeServiceId?: string
  isSuccess: boolean
  isLoading: boolean
  isFetching: boolean
  isPaused: boolean
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
  const providerServiceIds = providerDefinition
    ? getTradingProviderOAuthServiceIds(providerDefinition.id)
    : []
  const isQueryEnabled = enabled && Boolean(trimmedProviderId)
  const availabilityQuery = useOAuthProviderAvailability(providerServiceIds, isQueryEnabled)
  const connectionsQuery = useOAuthConnections({ enabled: isQueryEnabled })
  const serviceIds = providerServiceIds.filter(
    (serviceId) => availabilityQuery.data?.[serviceId] === true
  )
  const connections = isQueryEnabled ? (connectionsQuery.data ?? []) : []
  const connectedServiceIds = serviceIds.filter((serviceId) =>
    connections.some((service) => service.providerId === serviceId && service.isConnected)
  )
  const activeServiceId = resolveActiveTradingServiceId({
    serviceId,
    connectedServiceIds,
  })
  const error = availabilityQuery.error ?? connectionsQuery.error

  return {
    serviceIds,
    connectedServiceIds,
    activeServiceId,
    isSuccess: isQueryEnabled && availabilityQuery.isSuccess && connectionsQuery.isSuccess,
    isLoading: isQueryEnabled && (availabilityQuery.isLoading || connectionsQuery.isLoading),
    isFetching: isQueryEnabled && (availabilityQuery.isFetching || connectionsQuery.isFetching),
    isPaused: isQueryEnabled && (availabilityQuery.isPaused || connectionsQuery.isPaused),
    error: isQueryEnabled && error instanceof Error ? error : null,
    refetch: () => {
      void availabilityQuery.refetch()
      void connectionsQuery.refetch()
    },
  }
}

export function getTradingServiceName(providerId: string, serviceId: string) {
  return getServiceByProviderAndId(providerId, serviceId).name
}
