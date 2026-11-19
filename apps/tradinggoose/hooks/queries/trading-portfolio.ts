import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TradingOrderSubmitRequest,
  TradingOrderSubmitResponse,
} from '@/lib/trading/order-types'
import { useSocket } from '@/contexts/socket-context'
import {
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
  provider?: string
  serviceId?: string
  refreshKey?: number | string | null
  enabled?: boolean
}

type TradingSnapshotRequest = TradingAccountsRequest & {
  workspaceId?: string
  portfolioIdentity?: PortfolioIdentity | null
}

type TradingPerformanceRequest = TradingSnapshotRequest & {
  selectedWindow?: TradingPortfolioPerformanceWindow
}

type TradingPortfolioSubscribedPayload = {
  workspaceId?: string
  provider?: string
  serviceId?: string
  channel?: TradingPortfolioChannel
  subscriptionId?: string
  clientSubscriptionId?: string
  portfolioIdentity?: PortfolioIdentity | null
  window?: TradingPortfolioPerformanceWindow
  refreshId?: string
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
  refetch: () => Promise<{ data: T | undefined; error: Error | null }>
}

type SocketSubscriptionRef = {
  requestKey: string
  ended: boolean
  subscriptionId?: string
  clientSubscriptionId: string
  workspaceId?: string
  provider: string
  serviceId?: string
  channel: TradingPortfolioChannel
  portfolioIdentity?: PortfolioIdentity
}

type PendingSocketRefetch<T> = {
  requestKey: string
  refreshId: string
  promise: Promise<{ data: T | undefined; error: Error | null }>
  resolve: (result: { data: T | undefined; error: Error | null }) => void
  timeout: ReturnType<typeof setTimeout>
}

const PORTFOLIO_REFRESH_TIMEOUT_MS = 30_000

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
  workspaceId,
  serviceId,
  portfolioIdentity,
  window,
  refreshKey,
  enabled = true,
  dataEvent,
  getData,
}: {
  channel: TradingPortfolioChannel
  provider?: string
  workspaceId?: string
  serviceId?: string
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
  const runIdRef = useRef(0)
  const instanceIdRef = useRef<string | null>(null)
  if (!instanceIdRef.current) instanceIdRef.current = crypto.randomUUID()
  const subscriptionRef = useRef<SocketSubscriptionRef | null>(null)
  const pendingRefetchRef = useRef<PendingSocketRefetch<T> | null>(null)

  const settleRefetch = useCallback(
    (
      settledRequestKey: string,
      result: { data: T | undefined; error: Error | null },
      refreshId?: string
    ) => {
      const pending = pendingRefetchRef.current
      if (!pending || pending.requestKey !== settledRequestKey) return
      if (refreshId !== undefined && pending.refreshId !== refreshId) return
      clearTimeout(pending.timeout)
      pendingRefetchRef.current = null
      pending.resolve(result)
    },
    []
  )

  const normalizedProvider = provider?.trim()
  const normalizedWorkspaceId = workspaceId?.trim()
  const normalizedServiceId = serviceId?.trim()
  const normalizedPortfolioIdentity = toPortfolioValueObject(portfolioIdentity)
  const normalizedPortfolioIdentityKey = normalizedPortfolioIdentity
    ? getPortfolioIdentityKey(normalizedPortfolioIdentity)
    : ''
  const requestKey = [
    channel,
    normalizedWorkspaceId ?? '',
    normalizedProvider ?? '',
    normalizedServiceId ?? '',
    normalizedPortfolioIdentityKey,
    window ?? '',
  ].join('|')
  const data = dataState.key === requestKey ? dataState.data : undefined
  const shouldSubscribe =
    enabled &&
    Boolean(normalizedProvider) &&
    (channel === 'accounts' || Boolean(normalizedWorkspaceId)) &&
    (channel === 'accounts' || Boolean(normalizedPortfolioIdentityKey)) &&
    (channel !== 'portfolio-performance' || Boolean(window))
  const isCurrentRequestResolved = dataState.key === requestKey

  useEffect(() => {
    const pendingRefetch = pendingRefetchRef.current
    if (pendingRefetch && (pendingRefetch.requestKey !== requestKey || !shouldSubscribe)) {
      settleRefetch(pendingRefetch.requestKey, {
        data: undefined,
        error: new Error('Trading portfolio request changed before refresh completed'),
      })
    }

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
    const clientSubscriptionId = `trading-portfolio:${instanceIdRef.current}:${runId}`
    const subscription: SocketSubscriptionRef = {
      requestKey,
      ended: false,
      clientSubscriptionId,
      workspaceId: normalizedWorkspaceId,
      provider: normalizedProvider as string,
      serviceId: normalizedServiceId,
      channel,
      portfolioIdentity: normalizedPortfolioIdentity ?? undefined,
    }
    subscriptionRef.current = subscription

    setDataState({ key: requestKey, data: undefined })
    setError(null)
    setIsFetching(true)

    const isRelevantPayload = (payload: TradingPortfolioSubscribedPayload) =>
      payload.clientSubscriptionId === clientSubscriptionId &&
      (!subscription.subscriptionId || payload.subscriptionId === subscription.subscriptionId)

    const subscribe = (forceRefresh = false) => {
      if (subscription.ended) return
      setIsFetching(true)
      socket.emit('trading-portfolio-subscribe', {
        provider: normalizedProvider,
        workspaceId: normalizedWorkspaceId,
        serviceId: normalizedServiceId,
        channel,
        portfolioIdentity: normalizedPortfolioIdentity,
        window,
        clientSubscriptionId,
        forceRefresh,
      })
    }

    const handleSubscribed = (payload: TradingPortfolioSubscribedPayload) => {
      if (
        disposed ||
        subscription.ended ||
        payload.clientSubscriptionId !== clientSubscriptionId ||
        !payload.subscriptionId
      )
        return
      subscription.subscriptionId = payload.subscriptionId
    }

    const handleData = (payload: unknown) => {
      if (disposed || !isRelevantPayload(payload as TradingPortfolioSubscribedPayload)) return
      const nextData = getData(payload)
      if (nextData === undefined) return
      const refreshId = (payload as TradingPortfolioSubscribedPayload).refreshId
      const pending = pendingRefetchRef.current
      const settlesPending = pending?.requestKey === requestKey && pending.refreshId === refreshId
      if (refreshId !== undefined && !settlesPending) return
      setDataState({ key: requestKey, data: nextData })
      setError(null)
      if (!pending || settlesPending) setIsFetching(false)
      if (settlesPending) {
        settleRefetch(requestKey, { data: nextData, error: null }, refreshId)
      }
    }

    const handleError = (payload: TradingPortfolioErrorPayload) => {
      if (disposed || !isRelevantPayload(payload)) return
      const message =
        typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : typeof payload.error === 'string' && payload.error.trim()
            ? payload.error
            : 'Failed to load trading portfolio data'
      const nextError = new Error(message)
      const pending = pendingRefetchRef.current
      const settlesPending =
        pending?.requestKey === requestKey && pending.refreshId === payload.refreshId
      if (payload.refreshId !== undefined && !settlesPending) return
      setError(nextError)
      if (!pending || settlesPending) setIsFetching(false)
      if (settlesPending) {
        settleRefetch(requestKey, { data: undefined, error: nextError }, payload.refreshId)
      }
    }

    const handleSubscribeError = (payload: TradingPortfolioErrorPayload) => {
      if (disposed || !isRelevantPayload(payload)) return
      const message =
        typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : typeof payload.error === 'string' && payload.error.trim()
            ? payload.error
            : 'Failed to subscribe to trading portfolio data'
      const nextError = new Error(message)
      setError(nextError)
      setIsFetching(false)
      settleRefetch(requestKey, { data: undefined, error: nextError })
    }

    const failTransport = (message: string) => {
      if (disposed || subscription.ended) return
      const nextError = new Error(message)
      setError(nextError)
      setIsFetching(false)
      settleRefetch(requestKey, { data: undefined, error: nextError })
    }

    const handleConnect = () => {
      if (disposed || subscription.ended) return
      subscription.subscriptionId = undefined
      setError(null)
      subscribe(true)
    }
    const handleDisconnect = () => {
      subscription.subscriptionId = undefined
      failTransport('Trading portfolio connection was lost')
    }
    const handleConnectError = () => {
      subscription.subscriptionId = undefined
      failTransport('Trading portfolio connection failed')
    }

    socket.on('trading-portfolio-subscribed', handleSubscribed)
    socket.on(dataEvent, handleData)
    socket.on('trading-portfolio-error', handleError)
    socket.on('trading-portfolio-subscribe-error', handleSubscribeError)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    if (socket.connected) subscribe(refreshKey != null)

    return () => {
      disposed = true
      subscription.ended = true
      socket.off('trading-portfolio-subscribed', handleSubscribed)
      socket.off(dataEvent, handleData)
      socket.off('trading-portfolio-error', handleError)
      socket.off('trading-portfolio-subscribe-error', handleSubscribeError)
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)

      if (pendingRefetchRef.current?.requestKey === requestKey) {
        settleRefetch(requestKey, {
          data: undefined,
          error: new Error('Trading portfolio request changed before refresh completed'),
        })
      }

      if (socket.connected) {
        socket.emit(
          'trading-portfolio-unsubscribe',
          subscription.subscriptionId
            ? { subscriptionId: subscription.subscriptionId }
            : {
                provider: subscription.provider,
                workspaceId: subscription.workspaceId,
                serviceId: subscription.serviceId,
                channel: subscription.channel,
                portfolioIdentity: subscription.portfolioIdentity,
                clientSubscriptionId: subscription.clientSubscriptionId,
              }
        )
      }
      if (subscriptionRef.current === subscription) subscriptionRef.current = null
    }
  }, [
    channel,
    dataEvent,
    getData,
    normalizedServiceId,
    normalizedPortfolioIdentityKey,
    normalizedProvider,
    normalizedWorkspaceId,
    refreshKey,
    requestKey,
    settleRefetch,
    shouldSubscribe,
    socket,
    window,
  ])

  const refetch = useCallback(() => {
    const current = subscriptionRef.current
    if (
      !shouldSubscribe ||
      !socket?.connected ||
      !current ||
      current.ended ||
      current.requestKey !== requestKey
    ) {
      return Promise.resolve({
        data,
        error: new Error('Trading portfolio subscription is unavailable'),
      })
    }

    const existing = pendingRefetchRef.current
    if (existing?.requestKey === requestKey) {
      return existing.promise
    }

    if (existing) {
      settleRefetch(existing.requestKey, {
        data: undefined,
        error: new Error('Trading portfolio request changed before refresh completed'),
      })
    }

    let resolvePending: PendingSocketRefetch<T>['resolve'] = () => undefined
    const promise = new Promise<{ data: T | undefined; error: Error | null }>((resolve) => {
      resolvePending = resolve
    })
    const refreshId = crypto.randomUUID()
    const timeout = setTimeout(() => {
      const timeoutError = new Error('Trading portfolio refresh timed out')
      setError(timeoutError)
      setIsFetching(false)
      settleRefetch(requestKey, { data: undefined, error: timeoutError }, refreshId)
    }, PORTFOLIO_REFRESH_TIMEOUT_MS)
    pendingRefetchRef.current = {
      requestKey,
      refreshId,
      promise,
      resolve: resolvePending,
      timeout,
    }

    setIsFetching(true)
    socket.emit('trading-portfolio-refresh', {
      subscriptionId: current.subscriptionId,
      clientSubscriptionId: current.clientSubscriptionId,
      refreshId,
    })
    return promise
  }, [data, requestKey, settleRefetch, shouldSubscribe, socket])

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
    serviceId: request.serviceId,
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
    workspaceId: request.workspaceId,
    serviceId: request.serviceId,
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
    workspaceId: request.workspaceId,
    serviceId: request.serviceId,
    portfolioIdentity: request.portfolioIdentity,
    window: request.selectedWindow,
    refreshKey: request.refreshKey,
    enabled: request.enabled,
    dataEvent: 'trading-portfolio-performance',
    getData: getPerformancePayloadData,
  })
}

export const submitTradingOrder = (request: TradingOrderSubmitRequest) =>
  postJson<TradingOrderSubmitResponse>('/api/providers/trading/order', request)
