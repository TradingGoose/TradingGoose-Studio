import { createHash, randomUUID } from 'crypto'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  authorizeTradingConnectionRequest,
  resolveTradingProviderContext,
} from '@/lib/trading/context'
import { listTradingPortfolioIdentities } from '@/lib/trading/portfolio-identities'
import {
  getPortfolioDetail,
  getTradingAccountPerformance,
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
} from '@/providers/trading/portfolio'
import {
  arePortfolioIdentitiesEqual,
  getPortfolioIdentityKey,
  type PortfolioDetail,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type {
  TradingPortfolioBaseContext,
  TradingPortfolioPerformanceWindow,
  TradingProviderId,
} from '@/providers/trading/types'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'

const logger = createLogger('TradingPortfolioStreamManager')

const ACCOUNT_CACHE_TTL_MS = 60_000
const PORTFOLIO_POLL_TIMEOUT_MS = 20_000
const CHANNEL_POLL_INTERVAL_MS: Record<TradingPortfolioChannel, number> = {
  accounts: 60_000,
  'account-snapshot': 15_000,
  'portfolio-performance': 60_000,
}

export type TradingPortfolioChannel = 'accounts' | 'account-snapshot' | 'portfolio-performance'

export interface TradingPortfolioSubscribePayload {
  workspaceId?: string
  provider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity | null
  window?: TradingPortfolioPerformanceWindow
  channel?: TradingPortfolioChannel
  clientSubscriptionId?: string
  forceRefresh?: boolean
  pollIntervalSeconds?: number
}

export interface TradingPortfolioUnsubscribePayload {
  workspaceId?: string
  subscriptionId?: string
  clientSubscriptionId?: string
  provider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity | null
  channel?: TradingPortfolioChannel
}

export interface TradingPortfolioRefreshPayload extends TradingPortfolioUnsubscribePayload {
  refreshId?: string
}

export interface TradingPortfolioSubscriptionInfo {
  subscriptionId: string
  clientSubscriptionId?: string
  provider: TradingProviderId
  workspaceId?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  channel: TradingPortfolioChannel
  window?: TradingPortfolioPerformanceWindow
  pollIntervalMs?: number
}

interface TradingPortfolioSubscriptionRecord extends TradingPortfolioSubscriptionInfo {
  streamKey: string
  socketId?: string
  socket?: AuthenticatedSocket
  onData?: (payload: TradingPortfolioDataPayload) => void | Promise<void>
  onError?: (error: unknown, payload: TradingPortfolioErrorPayload) => void
}

interface TradingPortfolioStreamState {
  streamKey: string
  userId: string
  workspaceId?: string
  providerId: TradingProviderId
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  channel: TradingPortfolioChannel
  window?: TradingPortfolioPerformanceWindow
  pollingTimer?: ReturnType<typeof setInterval>
  pollingIntervalMs?: number
  pollingInFlight?: boolean
  lastPayload?: TradingPortfolioDataPayload
  activeForcedPoll?: TradingPortfolioForcedPollBatch
  queuedForcedPoll?: TradingPortfolioForcedPollBatch
  subscribers: Map<string, TradingPortfolioSubscriptionRecord>
}

interface TradingPortfolioForcedPollBatch {
  refreshIds: Map<string, string>
  uncorrelated: boolean
}

interface AccountsCacheEntry {
  data?: PortfolioIdentity[]
  expiresAt: number
  promise?: Promise<PortfolioIdentity[]>
}

type TradingPortfolioBasePayload = {
  provider: TradingProviderId
  workspaceId?: string
  serviceId?: string
  channel: TradingPortfolioChannel
  receivedAt: string
}

type TradingPortfolioAccountsPayload = TradingPortfolioBasePayload & {
  channel: 'accounts'
  portfolioIdentities: PortfolioIdentity[]
}

type TradingPortfolioSnapshotPayload = TradingPortfolioBasePayload & {
  channel: 'account-snapshot'
  portfolioIdentity: PortfolioIdentity
  portfolioDetail: PortfolioDetail
}

type TradingPortfolioPerformancePayload = TradingPortfolioBasePayload & {
  channel: 'portfolio-performance'
  portfolioIdentity: PortfolioIdentity
  window: TradingPortfolioPerformanceWindow
  performance: Awaited<ReturnType<typeof getTradingAccountPerformance>>
}

export type TradingPortfolioDataPayload =
  | TradingPortfolioAccountsPayload
  | TradingPortfolioSnapshotPayload
  | TradingPortfolioPerformancePayload

export type TradingPortfolioErrorPayload = TradingPortfolioSubscriptionInfo & {
  message: string
  refreshId?: string
}

function withPortfolioPollTimeout<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Trading portfolio refresh timed out')),
      PORTFOLIO_POLL_TIMEOUT_MS
    )
    timeout.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function redactPortfolioIdentity(portfolioIdentity?: PortfolioIdentity | null) {
  if (!portfolioIdentity) return undefined
  return {
    providerId: portfolioIdentity.providerId,
    providerName: portfolioIdentity.providerName,
    serviceId: portfolioIdentity.serviceId,
    accountType: portfolioIdentity.accountType,
    accountStatus: portfolioIdentity.accountStatus,
    baseCurrency: portfolioIdentity.baseCurrency,
  }
}

export class TradingPortfolioStreamManager {
  private streams = new Map<string, TradingPortfolioStreamState>()
  private socketSubscriptions = new Map<string, Map<string, TradingPortfolioSubscriptionRecord>>()
  private accountsCache = new Map<string, AccountsCacheEntry>()
  private dataSubscriptionSequence = 0
  private stopped = false

  async subscribe(
    socket: AuthenticatedSocket,
    payload: TradingPortfolioSubscribePayload
  ): Promise<TradingPortfolioSubscriptionInfo> {
    const userId = socket.userId
    if (!userId) throw new Error('Authentication required')

    const { record } = this.addSubscription({
      userId,
      workspaceId: payload.workspaceId,
      provider: payload.provider,
      serviceId: payload.serviceId,
      portfolioIdentity: payload.portfolioIdentity,
      channel: payload.channel,
      window: payload.window,
      forceRefresh: payload.forceRefresh,
      pollIntervalSeconds: payload.pollIntervalSeconds,
      clientSubscriptionId: payload.clientSubscriptionId,
      socket,
    })

    logger.info('Trading portfolio subscription added', {
      socketId: socket.id,
      userId,
      providerId: record.provider,
      workspaceId: record.workspaceId,
      serviceId: record.serviceId,
      portfolioIdentity: redactPortfolioIdentity(record.portfolioIdentity),
      channel: record.channel,
      window: record.window,
    })

    return toSubscriptionInfo(record)
  }

  subscribeData({
    userId,
    workspaceId,
    provider,
    serviceId: requestedServiceId,
    portfolioIdentity: requestedPortfolioIdentity,
    channel,
    window: requestedWindow,
    forceRefresh,
    pollIntervalSeconds,
    clientSubscriptionId,
    onData,
    onError,
  }: {
    userId: string
    workspaceId: string
    provider: string
    serviceId?: string
    portfolioIdentity?: PortfolioIdentity | null
    channel: TradingPortfolioChannel
    window?: TradingPortfolioPerformanceWindow
    forceRefresh?: boolean
    pollIntervalSeconds?: number
    clientSubscriptionId?: string
    onData: (payload: TradingPortfolioDataPayload) => void | Promise<void>
    onError?: (error: unknown, payload: TradingPortfolioErrorPayload) => void
  }): TradingPortfolioSubscriptionInfo & {
    unsubscribe: () => void
    refresh: () => void
  } {
    const { record, streamState } = this.addSubscription({
      userId,
      workspaceId,
      provider,
      serviceId: requestedServiceId,
      portfolioIdentity: requestedPortfolioIdentity,
      channel,
      window: requestedWindow,
      forceRefresh,
      pollIntervalSeconds,
      clientSubscriptionId,
      onData,
      onError,
    })

    return {
      ...toSubscriptionInfo(record),
      unsubscribe: () => this.removeRecord(record),
      refresh: () => this.requestForcedPoll(streamState),
    }
  }

  private addSubscription({
    userId,
    workspaceId,
    provider,
    serviceId: requestedServiceId,
    portfolioIdentity: requestedPortfolioIdentity,
    channel,
    window: requestedWindow,
    forceRefresh,
    pollIntervalSeconds,
    clientSubscriptionId,
    socket,
    onData,
    onError,
  }: {
    userId: string
    workspaceId?: string
    provider?: string
    serviceId?: string
    portfolioIdentity?: PortfolioIdentity | null
    channel?: TradingPortfolioChannel
    window?: TradingPortfolioPerformanceWindow
    forceRefresh?: boolean
    pollIntervalSeconds?: number
    clientSubscriptionId?: string
    socket?: AuthenticatedSocket
    onData?: (payload: TradingPortfolioDataPayload) => void | Promise<void>
    onError?: (error: unknown, payload: TradingPortfolioErrorPayload) => void
  }) {
    if (this.stopped) throw new Error('Trading portfolio stream manager is stopped')

    const normalizedClientSubscriptionId = clientSubscriptionId?.trim() || undefined

    const providerId = resolveTradingProviderId(provider, requestedPortfolioIdentity)
    const resolvedChannel = resolveChannel(channel)
    const resolvedWorkspaceId = resolveWorkspaceId(workspaceId, resolvedChannel)
    const serviceId = resolveServiceId(
      providerId,
      requestedServiceId ?? toPortfolioValueObject(requestedPortfolioIdentity)?.serviceId
    )
    const portfolioIdentity = resolvePortfolioIdentity(
      resolvedChannel,
      requestedPortfolioIdentity,
      providerId,
      serviceId
    )
    const window = resolvePerformanceWindow(providerId, resolvedChannel, requestedWindow)
    const pollIntervalMs = normalizePollIntervalMs(resolvedChannel, pollIntervalSeconds)
    const streamKey = buildStreamKey({
      userId,
      workspaceId: resolvedWorkspaceId,
      providerId,
      serviceId,
      portfolioIdentity,
      channel: resolvedChannel,
      window,
    })
    const streamState = this.getOrCreateStreamState({
      streamKey,
      userId,
      workspaceId: resolvedWorkspaceId,
      providerId,
      serviceId,
      portfolioIdentity,
      channel: resolvedChannel,
      window,
    })
    const subscriptionId = createSubscriptionId(
      streamKey,
      socket ? `${socket.id}:${randomUUID()}` : `data:${++this.dataSubscriptionSequence}`
    )
    const record: TradingPortfolioSubscriptionRecord = {
      subscriptionId,
      clientSubscriptionId: normalizedClientSubscriptionId,
      streamKey,
      socketId: socket?.id,
      socket,
      provider: providerId,
      workspaceId: resolvedWorkspaceId,
      serviceId,
      portfolioIdentity,
      channel: resolvedChannel,
      window,
      pollIntervalMs,
      onData,
      onError,
    }

    streamState.subscribers.set(subscriptionId, record)
    if (socket) {
      const socketMap = this.socketSubscriptions.get(socket.id) ?? new Map()
      socketMap.set(subscriptionId, record)
      this.socketSubscriptions.set(socket.id, socketMap)
    }

    if (streamState.lastPayload) {
      void this.emitData(record, streamState.lastPayload)
    }
    this.ensurePolling(streamState, Boolean(forceRefresh))

    return { record, streamState }
  }

  unsubscribe(
    socket: AuthenticatedSocket,
    payload: TradingPortfolioUnsubscribePayload
  ): TradingPortfolioSubscriptionInfo[] {
    const socketMap = this.socketSubscriptions.get(socket.id)
    if (!socketMap || socketMap.size === 0) return []

    const matches = this.findMatchingSubscriptions(socketMap, payload)
    matches.forEach((record) => this.removeRecord(record))
    return matches.map(toSubscriptionInfo)
  }

  refresh(
    socket: AuthenticatedSocket,
    payload: TradingPortfolioRefreshPayload
  ): TradingPortfolioSubscriptionInfo[] {
    const refreshId = payload.refreshId?.trim()
    const socketMap = this.socketSubscriptions.get(socket.id)
    const matches = socketMap ? this.findMatchingSubscriptions(socketMap, payload) : []
    if (refreshId && matches.length === 0)
      throw new Error('Trading portfolio subscription not found')

    if (refreshId) {
      matches.forEach((record) => {
        const state = this.streams.get(record.streamKey)
        if (!state) throw new Error('Trading portfolio stream not found')
        this.requestForcedPoll(state, { record, refreshId })
      })
    } else {
      new Set(matches.map((record) => record.streamKey)).forEach((streamKey) => {
        const state = this.streams.get(streamKey)
        if (state) this.requestForcedPoll(state)
      })
    }
    return matches.map(toSubscriptionInfo)
  }

  removeSocket(socketId: string) {
    const socketMap = this.socketSubscriptions.get(socketId)
    if (!socketMap) return

    socketMap.forEach((record) => this.removeRecord(record))
  }

  stop() {
    this.stopped = true
    this.streams.forEach((streamState) => {
      if (streamState.pollingTimer) {
        clearInterval(streamState.pollingTimer)
      }
      streamState.activeForcedPoll?.refreshIds.clear()
      streamState.queuedForcedPoll?.refreshIds.clear()
      streamState.subscribers.clear()
    })
    this.streams.clear()
    this.socketSubscriptions.clear()
    this.accountsCache.clear()
  }

  private getOrCreateStreamState(
    config: Omit<
      TradingPortfolioStreamState,
      'activeForcedPoll' | 'queuedForcedPoll' | 'subscribers'
    >
  ): TradingPortfolioStreamState {
    const existing = this.streams.get(config.streamKey)
    if (existing) return existing

    const next: TradingPortfolioStreamState = {
      ...config,
      subscribers: new Map(),
    }
    this.streams.set(config.streamKey, next)
    return next
  }

  private ensurePolling(streamState: TradingPortfolioStreamState, forceRefresh: boolean) {
    const intervalMs = Math.min(
      ...Array.from(streamState.subscribers.values()).map(
        (subscriber) => subscriber.pollIntervalMs ?? CHANNEL_POLL_INTERVAL_MS[streamState.channel]
      )
    )

    if (streamState.pollingTimer && streamState.pollingIntervalMs !== intervalMs) {
      clearInterval(streamState.pollingTimer)
      streamState.pollingTimer = undefined
    }

    if (!streamState.pollingTimer) {
      streamState.pollingIntervalMs = intervalMs
      streamState.pollingTimer = setInterval(() => {
        void this.pollState(streamState, false)
      }, intervalMs)
      streamState.pollingTimer.unref?.()
    }

    if (forceRefresh) {
      this.requestForcedPoll(streamState)
    } else if (!streamState.lastPayload) {
      void this.pollState(streamState, false)
    }
  }

  private requestForcedPoll(
    streamState: TradingPortfolioStreamState,
    request?: { record: TradingPortfolioSubscriptionRecord; refreshId: string }
  ) {
    if (request) {
      const subscriptionId = request.record.subscriptionId
      const activeRefreshId = streamState.activeForcedPoll?.refreshIds.get(subscriptionId)
      const queuedRefreshId = streamState.queuedForcedPoll?.refreshIds.get(subscriptionId)
      if (activeRefreshId === request.refreshId || queuedRefreshId === request.refreshId) return
      if (activeRefreshId || queuedRefreshId) {
        throw new Error('Trading portfolio refresh already pending')
      }
    }

    const batch = streamState.pollingInFlight
      ? (streamState.queuedForcedPoll ?? {
          refreshIds: new Map<string, string>(),
          uncorrelated: false,
        })
      : {
          refreshIds: new Map<string, string>(),
          uncorrelated: false,
        }

    if (request) {
      batch.refreshIds.set(request.record.subscriptionId, request.refreshId)
    } else {
      batch.uncorrelated = true
    }

    if (streamState.pollingInFlight) {
      streamState.queuedForcedPoll = batch
      return
    }
    void this.pollState(streamState, true, batch)
  }

  private async pollState(
    streamState: TradingPortfolioStreamState,
    forceRefresh: boolean,
    forcedPoll?: TradingPortfolioForcedPollBatch
  ) {
    if (this.stopped) return
    if (streamState.pollingInFlight) return
    if (streamState.subscribers.size === 0) return

    streamState.pollingInFlight = true
    streamState.activeForcedPoll = forcedPoll
    try {
      const payload = await withPortfolioPollTimeout(this.loadPayload(streamState, forceRefresh))
      if (this.stopped || streamState.subscribers.size === 0) return
      streamState.lastPayload = payload
      await this.emitToSubscribers(streamState, payload, forcedPoll)
    } catch (error) {
      if (this.stopped) return
      this.emitErrorToSubscribers(streamState, error, forcedPoll)
    } finally {
      streamState.pollingInFlight = false
      streamState.activeForcedPoll = undefined
      const nextForcedPoll = streamState.queuedForcedPoll
      streamState.queuedForcedPoll = undefined
      if (
        nextForcedPoll &&
        streamState.subscribers.size > 0 &&
        (nextForcedPoll.uncorrelated || nextForcedPoll.refreshIds.size > 0)
      ) {
        void this.pollState(streamState, true, nextForcedPoll)
      }
    }
  }

  private async loadPayload(
    streamState: TradingPortfolioStreamState,
    forceRefresh: boolean
  ): Promise<TradingPortfolioDataPayload> {
    if (streamState.channel === 'accounts') {
      return {
        provider: streamState.providerId,
        workspaceId: streamState.workspaceId,
        serviceId: streamState.serviceId,
        channel: 'accounts',
        portfolioIdentities: await this.getAccounts(streamState, forceRefresh),
        receivedAt: new Date().toISOString(),
      }
    }

    const context = await resolveTradingPortfolioContext(streamState)
    const portfolioIdentity = await this.getSelectedPortfolioIdentity(streamState, forceRefresh)

    if (streamState.channel === 'account-snapshot') {
      const portfolioDetail = await getPortfolioDetail({
        providerId: context.providerId,
        credentialId: context.credentialId,
        tokenAccountId: context.tokenAccountId,
        serviceId: context.serviceId,
        environment: context.environment,
        accessToken: context.accessToken,
        accountId: portfolioIdentity.accountId,
      })
      return {
        provider: streamState.providerId,
        workspaceId: streamState.workspaceId,
        serviceId: streamState.serviceId,
        channel: 'account-snapshot',
        portfolioIdentity: toPortfolioValueObject(portfolioDetail) ?? portfolioIdentity,
        portfolioDetail,
        receivedAt: new Date().toISOString(),
      }
    }

    if (!streamState.window) throw new Error('performance window is required')
    return {
      provider: streamState.providerId,
      workspaceId: streamState.workspaceId,
      serviceId: streamState.serviceId,
      channel: 'portfolio-performance',
      portfolioIdentity,
      window: streamState.window,
      performance: await getTradingAccountPerformance({
        providerId: context.providerId,
        credentialId: context.credentialId,
        tokenAccountId: context.tokenAccountId,
        serviceId: context.serviceId,
        environment: context.environment,
        accessToken: context.accessToken,
        accountId: portfolioIdentity.accountId,
        window: streamState.window,
      }),
      receivedAt: new Date().toISOString(),
    }
  }

  private async getAccounts(
    streamState: TradingPortfolioStreamState,
    forceRefresh: boolean
  ): Promise<PortfolioIdentity[]> {
    const cacheKey = buildAccountsCacheKey(streamState)
    const cached = this.accountsCache.get(cacheKey)
    const now = Date.now()

    if (!forceRefresh && cached?.data && cached.expiresAt > now) {
      return cached.data
    }

    if (!forceRefresh && cached?.promise) {
      return cached.promise
    }

    const promise = listTradingPortfolioIdentities({
      userId: streamState.userId,
      providerId: streamState.providerId,
      serviceId: streamState.serviceId,
      credentialId: streamState.portfolioIdentity?.credentialId,
      requestId: streamState.streamKey,
    })
    this.accountsCache.set(cacheKey, {
      data: cached?.data,
      expiresAt: cached?.expiresAt ?? 0,
      promise,
    })

    try {
      const data = await promise
      if (this.accountsCache.get(cacheKey)?.promise === promise) {
        this.accountsCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
        })
      }
      return data
    } catch (error) {
      if (this.accountsCache.get(cacheKey)?.promise === promise) {
        if (cached?.data) {
          this.accountsCache.set(cacheKey, cached)
        } else {
          this.accountsCache.delete(cacheKey)
        }
      }
      throw error
    }
  }

  private async getSelectedPortfolioIdentity(
    streamState: TradingPortfolioStreamState,
    forceRefresh: boolean
  ) {
    const portfolioIdentity = streamState.portfolioIdentity
    if (!portfolioIdentity) throw new Error('portfolioIdentity is required')

    const accounts = await this.getAccounts(streamState, forceRefresh)
    const account = accounts.find((candidate) =>
      arePortfolioIdentitiesEqual(candidate, portfolioIdentity)
    )
    if (!account) throw new Error('Portfolio not found for provider connection')
    return account
  }

  private async emitToSubscribers(
    streamState: TradingPortfolioStreamState,
    payload: TradingPortfolioDataPayload,
    forcedPoll?: TradingPortfolioForcedPollBatch
  ) {
    await Promise.all(
      Array.from(streamState.subscribers.values()).map((record) =>
        this.emitData(record, payload, forcedPoll?.refreshIds.get(record.subscriptionId))
      )
    )
  }

  private async emitData(
    record: TradingPortfolioSubscriptionRecord,
    payload: TradingPortfolioDataPayload,
    refreshId?: string
  ) {
    const emittedPayload = refreshId ? { ...payload, refreshId } : payload
    if (record.onData) {
      await record.onData(emittedPayload)
      return
    }
    if (!record.socket) return

    const basePayload = {
      ...emittedPayload,
      subscriptionId: record.subscriptionId,
      clientSubscriptionId: record.clientSubscriptionId,
    }

    if (payload.channel === 'accounts') {
      record.socket.emit('trading-portfolio-accounts', basePayload)
      return
    }

    if (payload.channel === 'account-snapshot') {
      record.socket.emit('trading-portfolio-snapshot', basePayload)
      return
    }

    record.socket.emit('trading-portfolio-performance', basePayload)
  }

  private emitErrorToSubscribers(
    streamState: TradingPortfolioStreamState,
    error: unknown,
    forcedPoll?: TradingPortfolioForcedPollBatch
  ) {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof TradingBrokerRequestError) {
      logger.error('Trading portfolio broker request failed', {
        providerId: error.providerId,
        status: error.status,
        error: error.message,
      })
    } else {
      logger.error('Trading portfolio poll failed', {
        providerId: streamState.providerId,
        channel: streamState.channel,
        portfolioIdentity: redactPortfolioIdentity(streamState.portfolioIdentity),
        error: message,
      })
    }

    streamState.subscribers.forEach((record) => {
      const refreshId = forcedPoll?.refreshIds.get(record.subscriptionId)
      const payload: TradingPortfolioErrorPayload = {
        ...toSubscriptionInfo(record),
        message,
        ...(refreshId ? { refreshId } : {}),
      }
      if (record.onError) {
        record.onError(error, payload)
        return
      }
      record.socket?.emit('trading-portfolio-error', payload)
    })
  }

  private findMatchingSubscriptions(
    socketMap: Map<string, TradingPortfolioSubscriptionRecord>,
    payload: TradingPortfolioUnsubscribePayload
  ) {
    if (payload.subscriptionId) {
      const match = socketMap.get(payload.subscriptionId)
      return match ? [match] : []
    }
    if (payload.clientSubscriptionId) {
      return Array.from(socketMap.values()).filter(
        (record) => record.clientSubscriptionId === payload.clientSubscriptionId
      )
    }

    const providerId = payload.provider?.trim()
    const workspaceId = payload.workspaceId?.trim()
    const serviceId = payload.serviceId?.trim()
    const portfolioIdentity = toPortfolioValueObject(payload.portfolioIdentity)
    return Array.from(socketMap.values()).filter(
      (record) =>
        (!providerId || record.provider === providerId) &&
        (!workspaceId || record.workspaceId === workspaceId) &&
        (!serviceId || record.serviceId === serviceId) &&
        (!payload.channel || record.channel === payload.channel) &&
        (!portfolioIdentity ||
          arePortfolioIdentitiesEqual(record.portfolioIdentity, portfolioIdentity))
    )
  }

  private removeRecord(record: TradingPortfolioSubscriptionRecord) {
    if (record.socketId) {
      const socketMap = this.socketSubscriptions.get(record.socketId)
      if (socketMap) {
        socketMap.delete(record.subscriptionId)
        if (socketMap.size === 0) {
          this.socketSubscriptions.delete(record.socketId)
        }
      }
    }

    const streamState = this.streams.get(record.streamKey)
    if (!streamState) return

    streamState.activeForcedPoll?.refreshIds.delete(record.subscriptionId)
    streamState.queuedForcedPoll?.refreshIds.delete(record.subscriptionId)
    if (
      streamState.queuedForcedPoll &&
      !streamState.queuedForcedPoll.uncorrelated &&
      streamState.queuedForcedPoll.refreshIds.size === 0
    ) {
      streamState.queuedForcedPoll = undefined
    }
    streamState.subscribers.delete(record.subscriptionId)
    if (streamState.subscribers.size === 0) {
      if (streamState.pollingTimer) {
        clearInterval(streamState.pollingTimer)
      }
      this.streams.delete(record.streamKey)
    } else {
      this.ensurePolling(streamState, false)
    }

    logger.info('Trading portfolio subscription removed', {
      socketId: record.socketId,
      userId: record.socket?.userId,
      provider: record.provider,
      serviceId: record.serviceId,
      portfolioIdentity: redactPortfolioIdentity(record.portfolioIdentity),
      channel: record.channel,
      window: record.window,
    })
  }
}

export const tradingPortfolioStreamManager = new TradingPortfolioStreamManager()

async function resolveTradingPortfolioContext(
  streamState: TradingPortfolioStreamState
): Promise<TradingPortfolioBaseContext> {
  const credentialId = streamState.portfolioIdentity?.credentialId
  if (!credentialId) throw new Error('portfolioIdentity credential is required')
  const workspaceId = streamState.workspaceId
  if (!workspaceId) throw new Error('workspaceId is required')
  const serviceId = streamState.serviceId
  if (!serviceId) throw new Error('Trading provider connection is required')

  const workspaceAccess = await checkWorkspaceAccess(workspaceId, streamState.userId)
  if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
    throw new Error('Trading portfolio workspace not found')
  }

  const connection = await authorizeTradingConnectionRequest({
    credentialId,
    userId: streamState.userId,
  })

  const context = await resolveTradingProviderContext({
    requestData: {
      provider: streamState.providerId,
      credentialId,
      serviceId,
    },
    requestId: streamState.streamKey,
    userId: streamState.userId,
    connectionOwnerUserId: connection.connectionOwnerUserId,
    tokenAccountId: connection.tokenAccountId,
    accountProviderId: connection.accountProviderId,
  })
  return {
    ...context,
    providerId: streamState.providerId,
  }
}

function resolveTradingProviderId(
  provider?: string,
  portfolioIdentity?: PortfolioIdentity | null
): TradingProviderId {
  const providerId =
    provider?.trim() ??
    (toPortfolioValueObject(portfolioIdentity)?.providerId as string | undefined)
  if (!providerId) throw new Error('trading provider is required')
  if (!getTradingProviderDefinition(providerId)) {
    throw new Error('Unsupported trading provider')
  }
  return providerId as TradingProviderId
}

function resolveWorkspaceId(workspaceId: string | undefined, channel: TradingPortfolioChannel) {
  const resolvedWorkspaceId = workspaceId?.trim()
  if (!resolvedWorkspaceId && channel !== 'accounts') throw new Error('workspaceId is required')
  return resolvedWorkspaceId
}

function resolveServiceId(providerId: TradingProviderId, serviceId?: string) {
  const resolvedServiceId = getTradingProviderOAuthServiceId(providerId, serviceId)
  if (!resolvedServiceId) throw new Error('Trading provider connection is required')
  return resolvedServiceId
}

function resolveChannel(channel?: TradingPortfolioChannel): TradingPortfolioChannel {
  if (!channel) return 'account-snapshot'
  if (
    channel === 'accounts' ||
    channel === 'account-snapshot' ||
    channel === 'portfolio-performance'
  ) {
    return channel
  }
  throw new Error('Unsupported trading portfolio channel')
}

function normalizePollIntervalMs(channel: TradingPortfolioChannel, pollIntervalSeconds?: number) {
  const defaultIntervalMs = CHANNEL_POLL_INTERVAL_MS[channel]
  if (typeof pollIntervalSeconds !== 'number' || !Number.isFinite(pollIntervalSeconds)) {
    return defaultIntervalMs
  }

  return Math.max(15_000, Math.min(3_600_000, Math.trunc(pollIntervalSeconds) * 1000))
}

function resolvePortfolioIdentity(
  channel: TradingPortfolioChannel,
  requestedPortfolioIdentity: PortfolioIdentity | null | undefined,
  providerId: TradingProviderId,
  serviceId: string
) {
  if (channel === 'accounts') return undefined
  const portfolioIdentity = toPortfolioValueObject(requestedPortfolioIdentity)
  if (!portfolioIdentity) throw new Error('portfolioIdentity is required')
  if (portfolioIdentity.providerId !== providerId) {
    throw new Error('portfolioIdentity provider does not match subscription provider')
  }
  if (portfolioIdentity.serviceId !== serviceId) {
    throw new Error('portfolioIdentity service does not match subscription service')
  }
  return portfolioIdentity
}

function resolvePerformanceWindow(
  providerId: TradingProviderId,
  channel: TradingPortfolioChannel,
  window?: TradingPortfolioPerformanceWindow
) {
  if (channel !== 'portfolio-performance') return undefined
  const candidate = window?.trim() as TradingPortfolioPerformanceWindow | undefined
  const supportedWindows = getTradingPortfolioSupportedWindows(providerId)
  const resolvedWindow = candidate || supportedWindows[0]
  if (!resolvedWindow) throw new Error('performance window is required')
  if (!isTradingPortfolioWindowSupported(providerId, resolvedWindow)) {
    throw new Error('Unsupported performance window')
  }
  return resolvedWindow
}

function buildStreamKey(config: {
  userId: string
  workspaceId?: string
  providerId: TradingProviderId
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  channel: TradingPortfolioChannel
  window?: TradingPortfolioPerformanceWindow
}) {
  return createHash('sha256')
    .update(
      [
        config.userId,
        config.workspaceId ?? '',
        config.providerId,
        config.serviceId ?? '',
        config.channel,
        config.portfolioIdentity ? getPortfolioIdentityKey(config.portfolioIdentity) : '',
        config.window ?? '',
      ].join('|')
    )
    .digest('hex')
}

function buildAccountsCacheKey(streamState: TradingPortfolioStreamState) {
  return createHash('sha256')
    .update(
      [
        streamState.userId,
        streamState.workspaceId ?? '',
        streamState.providerId,
        streamState.serviceId ?? '',
        streamState.portfolioIdentity?.credentialId ?? '',
      ].join('|')
    )
    .digest('hex')
}

function createSubscriptionId(streamKey: string, ownerId: string) {
  return `${streamKey}:${ownerId}`
}

function toSubscriptionInfo(
  record: TradingPortfolioSubscriptionRecord
): TradingPortfolioSubscriptionInfo {
  return {
    subscriptionId: record.subscriptionId,
    clientSubscriptionId: record.clientSubscriptionId,
    provider: record.provider,
    workspaceId: record.workspaceId,
    serviceId: record.serviceId,
    portfolioIdentity: record.portfolioIdentity,
    channel: record.channel,
    window: record.window,
    pollIntervalMs: record.pollIntervalMs,
  }
}
