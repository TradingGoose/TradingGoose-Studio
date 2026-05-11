import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type {
  TradingOrderSubmitRequest,
  TradingOrderSubmitResponse,
} from '@/lib/trading/order-types'
import { useSocket } from '@/contexts/socket-context'
import {
  arePortfolioIdentitiesEqual,
  getPortfolioIdentityKey,
  type PortfolioDetail,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import type {
  TradingPortfolioPerformanceWindow,
  UnifiedTradingPortfolioPerformance,
} from '@/providers/trading/types'

type TradingPortfolioChannel = 'accounts' | 'account-snapshot' | 'portfolio-performance'

type TradingAccountsRequest = {
  workspaceId?: string
  provider?: string
  credentialServiceId?: string
  refreshKey?: number | string | null
  enabled?: boolean
}

type TradingSnapshotRequest = TradingAccountsRequest & {
  portfolioIdentity?: PortfolioIdentity | null
}

type TradingPerformanceRequest = TradingSnapshotRequest & {
  selectedWindow?: TradingPortfolioPerformanceWindow
}

type TradingPortfolioSubscribedPayload = {
  provider?: string
  credentialServiceId?: string
  workspaceId?: string
  channel?: TradingPortfolioChannel
  subscriptionId?: string
  clientSubscriptionId?: string
  portfolioIdentity?: PortfolioIdentity | null
  window?: TradingPortfolioPerformanceWindow
}

type TradingPortfolioErrorPayload = TradingPortfolioSubscribedPayload & {
  error?: string
  message?: string
}

type TradingPortfolioAccountsPayload = TradingPortfolioSubscribedPayload & {
  channel?: 'accounts'
  portfolioIdentities?: PortfolioIdentity[]
}

type TradingPortfolioSnapshotPayload = TradingPortfolioSubscribedPayload & {
  channel?: 'account-snapshot'
  portfolioDetail?: PortfolioDetail
}

type TradingPortfolioPerformancePayload = TradingPortfolioSubscribedPayload & {
  channel?: 'portfolio-performance'
  performance?: UnifiedTradingPortfolioPerformance
}

type TradingSocketQueryResult<T> = {
  data: T | undefined
  error: Error | null
  isLoading: boolean
  isFetching: boolean
  refetch: () => Promise<{ data: T | undefined }>
}

type SocketSubscriptionRef = {
  subscriptionId?: string
  clientSubscriptionId: string
  provider: string
  credentialServiceId?: string
  workspaceId: string
  channel: TradingPortfolioChannel
  portfolioIdentity?: PortfolioIdentity
}

const getAccountsPayloadData = (payload: TradingPortfolioAccountsPayload) =>
  payload.portfolioIdentities

const getSnapshotPayloadData = (payload: TradingPortfolioSnapshotPayload) => payload.portfolioDetail

const getPerformancePayloadData = (payload: TradingPortfolioPerformancePayload) =>
  payload.performance

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`)
  }

  return payload as T
}

function useTradingPortfolioSocketData<T>({
  channel,
  provider,
  credentialServiceId,
  workspaceId,
  portfolioIdentity,
  window,
  refreshKey,
  enabled = true,
  dataEvent,
  getData,
}: {
  channel: TradingPortfolioChannel
  provider?: string
  credentialServiceId?: string
  workspaceId?: string
  portfolioIdentity?: PortfolioIdentity | null
  window?: TradingPortfolioPerformanceWindow
  refreshKey?: number | string | null
  enabled?: boolean
  dataEvent:
    | 'trading-portfolio-accounts'
    | 'trading-portfolio-snapshot'
    | 'trading-portfolio-performance'
  getData: (payload: any) => T | undefined
}): TradingSocketQueryResult<T> {
  const { socket } = useSocket()
  const [dataState, setDataState] = useState<{ key: string; data: T | undefined }>({
    key: '',
    data: undefined,
  })
  const [error, setError] = useState<Error | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [refetchNonce, setRefetchNonce] = useState(0)
  const runIdRef = useRef(0)
  const subscriptionRef = useRef<SocketSubscriptionRef | null>(null)

  const normalizedProvider = provider?.trim()
  const normalizedCredentialServiceId = credentialServiceId?.trim()
  const normalizedWorkspaceId = workspaceId?.trim()
  const normalizedPortfolioIdentity = toPortfolioValueObject(portfolioIdentity)
  const normalizedPortfolioIdentityKey = normalizedPortfolioIdentity
    ? getPortfolioIdentityKey(normalizedPortfolioIdentity)
    : ''
  const requestKey = [
    channel,
    normalizedWorkspaceId ?? '',
    normalizedProvider ?? '',
    normalizedCredentialServiceId ?? '',
    normalizedPortfolioIdentityKey,
    window ?? '',
  ].join('|')
  const data = dataState.key === requestKey ? dataState.data : undefined
  const shouldSubscribe =
    enabled &&
    Boolean(normalizedProvider) &&
    Boolean(normalizedWorkspaceId) &&
    (channel === 'accounts' || Boolean(normalizedPortfolioIdentityKey)) &&
    (channel !== 'portfolio-performance' || Boolean(window))
  const isCurrentRequestResolved = dataState.key === requestKey

  useEffect(() => {
    subscriptionRef.current = null

    if (!shouldSubscribe) {
      setDataState({ key: requestKey, data: undefined })
      setError(null)
      setIsFetching(false)
      return
    }

    if (!socket) {
      setError(null)
      setIsFetching(true)
      return
    }

    let disposed = false
    runIdRef.current += 1
    const runId = runIdRef.current
    const clientSubscriptionId = [
      'trading-portfolio',
      channel,
      runId,
      normalizedProvider,
      normalizedPortfolioIdentityKey || 'accounts',
      window ?? '',
    ].join(':')

    subscriptionRef.current = {
      clientSubscriptionId,
      provider: normalizedProvider as string,
      credentialServiceId: normalizedCredentialServiceId,
      workspaceId: normalizedWorkspaceId as string,
      channel,
      portfolioIdentity: normalizedPortfolioIdentity ?? undefined,
    }

    setDataState({ key: requestKey, data: undefined })
    setError(null)
    setIsFetching(true)

    const isRelevantPayload = (payload: TradingPortfolioSubscribedPayload) => {
      if (payload.channel && payload.channel !== channel) return false
      if (payload.provider && payload.provider !== normalizedProvider) return false
      if (
        payload.credentialServiceId &&
        normalizedCredentialServiceId &&
        payload.credentialServiceId !== normalizedCredentialServiceId
      ) {
        return false
      }
      if (payload.workspaceId && payload.workspaceId !== normalizedWorkspaceId) return false
      const payloadPortfolioIdentity = toPortfolioValueObject(payload.portfolioIdentity)
      if (
        payloadPortfolioIdentity &&
        normalizedPortfolioIdentity &&
        !arePortfolioIdentitiesEqual(payloadPortfolioIdentity, normalizedPortfolioIdentity)
      ) {
        return false
      }
      if (payload.clientSubscriptionId) {
        return payload.clientSubscriptionId === clientSubscriptionId
      }
      const currentSubscriptionId = subscriptionRef.current?.subscriptionId
      if (payload.subscriptionId && currentSubscriptionId) {
        return payload.subscriptionId === currentSubscriptionId
      }
      return false
    }

    const subscribe = (forceRefresh = false) => {
      socket.emit('trading-portfolio-subscribe', {
        provider: normalizedProvider,
        credentialServiceId: normalizedCredentialServiceId,
        workspaceId: normalizedWorkspaceId,
        channel,
        portfolioIdentity: normalizedPortfolioIdentity,
        window,
        clientSubscriptionId,
        forceRefresh,
      })
    }

    const handleSubscribed = (payload: TradingPortfolioSubscribedPayload) => {
      if (disposed || !isRelevantPayload(payload) || !payload.subscriptionId) return
      subscriptionRef.current = {
        ...(subscriptionRef.current as SocketSubscriptionRef),
        subscriptionId: payload.subscriptionId,
      }
    }

    const handleData = (payload: unknown) => {
      if (disposed || !isRelevantPayload(payload as TradingPortfolioSubscribedPayload)) return
      const nextData = getData(payload)
      if (nextData === undefined) return
      setDataState({ key: requestKey, data: nextData })
      setError(null)
      setIsFetching(false)
    }

    const handleError = (payload: TradingPortfolioErrorPayload) => {
      if (disposed || !isRelevantPayload(payload)) return
      const message =
        typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : typeof payload.error === 'string' && payload.error.trim()
            ? payload.error
            : 'Failed to load trading portfolio data'
      setError(new Error(message))
      setIsFetching(false)
    }

    socket.on('trading-portfolio-subscribed', handleSubscribed)
    socket.on(dataEvent, handleData)
    socket.on('trading-portfolio-error', handleError)
    socket.on('trading-portfolio-subscribe-error', handleError)
    socket.on('connect', subscribe)
    subscribe(refreshKey != null || refetchNonce > 0)

    return () => {
      disposed = true
      socket.off('trading-portfolio-subscribed', handleSubscribed)
      socket.off(dataEvent, handleData)
      socket.off('trading-portfolio-error', handleError)
      socket.off('trading-portfolio-subscribe-error', handleError)
      socket.off('connect', subscribe)

      const current = subscriptionRef.current
      if (!current || current.clientSubscriptionId !== clientSubscriptionId) return
      if (current.subscriptionId) {
        socket.emit('trading-portfolio-unsubscribe', {
          subscriptionId: current.subscriptionId,
        })
      } else {
        socket.emit('trading-portfolio-unsubscribe', {
          provider: current.provider,
          credentialServiceId: current.credentialServiceId,
          channel: current.channel,
          portfolioIdentity: current.portfolioIdentity,
          clientSubscriptionId: current.clientSubscriptionId,
        })
      }
      subscriptionRef.current = null
    }
  }, [
    channel,
    dataEvent,
    getData,
    normalizedCredentialServiceId,
    normalizedPortfolioIdentityKey,
    normalizedProvider,
    normalizedWorkspaceId,
    refetchNonce,
    refreshKey,
    requestKey,
    shouldSubscribe,
    socket,
    window,
  ])

  const refetch = useCallback(async () => {
    const current = subscriptionRef.current
    if (socket && current) {
      setIsFetching(true)
      socket.emit('trading-portfolio-refresh', {
        subscriptionId: current.subscriptionId,
        clientSubscriptionId: current.clientSubscriptionId,
        provider: current.provider,
        credentialServiceId: current.credentialServiceId,
        channel: current.channel,
        portfolioIdentity: current.portfolioIdentity,
      })
    } else {
      setRefetchNonce((value) => value + 1)
    }
    return { data }
  }, [data, socket])

  return {
    data,
    error,
    isLoading: shouldSubscribe && data === undefined && (isFetching || !isCurrentRequestResolved),
    isFetching,
    refetch,
  }
}

export function usePortfolioIdentities(request: TradingAccountsRequest) {
  return useTradingPortfolioSocketData<PortfolioIdentity[]>({
    channel: 'accounts',
    provider: request.provider,
    credentialServiceId: request.credentialServiceId,
    workspaceId: request.workspaceId,
    refreshKey: request.refreshKey,
    enabled: request.enabled,
    dataEvent: 'trading-portfolio-accounts',
    getData: getAccountsPayloadData,
  })
}

export function usePortfolioDetail(request: TradingSnapshotRequest) {
  return useTradingPortfolioSocketData<PortfolioDetail>({
    channel: 'account-snapshot',
    provider: request.provider,
    credentialServiceId: request.credentialServiceId,
    workspaceId: request.workspaceId,
    portfolioIdentity: request.portfolioIdentity,
    refreshKey: request.refreshKey,
    enabled: request.enabled,
    dataEvent: 'trading-portfolio-snapshot',
    getData: getSnapshotPayloadData,
  })
}

export function usePortfolioPerformance(request: TradingPerformanceRequest) {
  return useTradingPortfolioSocketData<UnifiedTradingPortfolioPerformance>({
    channel: 'portfolio-performance',
    provider: request.provider,
    credentialServiceId: request.credentialServiceId,
    workspaceId: request.workspaceId,
    portfolioIdentity: request.portfolioIdentity,
    window: request.selectedWindow,
    refreshKey: request.refreshKey,
    enabled: request.enabled,
    dataEvent: 'trading-portfolio-performance',
    getData: getPerformancePayloadData,
  })
}

export function useSubmitTradingOrder() {
  return useMutation<TradingOrderSubmitResponse, Error, TradingOrderSubmitRequest>({
    mutationFn: (request) =>
      postJson<TradingOrderSubmitResponse>('/api/providers/trading/order', request),
  })
}
