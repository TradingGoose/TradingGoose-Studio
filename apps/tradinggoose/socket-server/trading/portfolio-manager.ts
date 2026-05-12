import { createHash, randomUUID } from 'crypto'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthTokenByCredentialId } from '@/lib/oauth/tokens'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
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
  getTradingProviderOAuthEnvironment,
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
const CHANNEL_POLL_INTERVAL_MS: Record<TradingPortfolioChannel, number> = {
  accounts: 60_000,
  'account-snapshot': 15_000,
  'portfolio-performance': 60_000,
}

export type TradingPortfolioChannel = 'accounts' | 'account-snapshot' | 'portfolio-performance'

export interface TradingPortfolioSubscribePayload {
  provider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity | null
  workspaceId?: string
  window?: TradingPortfolioPerformanceWindow
  channel?: TradingPortfolioChannel
  clientSubscriptionId?: string
  forceRefresh?: boolean
}

export interface TradingPortfolioUnsubscribePayload {
  subscriptionId?: string
  clientSubscriptionId?: string
  provider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity | null
  channel?: TradingPortfolioChannel
}

export interface TradingPortfolioSubscriptionInfo {
  subscriptionId: string
  clientSubscriptionId?: string
  provider: TradingProviderId
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  workspaceId: string
  channel: TradingPortfolioChannel
  window?: TradingPortfolioPerformanceWindow
}

interface TradingPortfolioSubscriptionRecord extends TradingPortfolioSubscriptionInfo {
  streamKey: string
  socketId: string
  socket: AuthenticatedSocket
}

interface TradingPortfolioStreamState {
  streamKey: string
  userId: string
  workspaceId: string
  providerId: TradingProviderId
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  channel: TradingPortfolioChannel
  window?: TradingPortfolioPerformanceWindow
  pollingTimer?: ReturnType<typeof setInterval>
  pollingInFlight?: boolean
  lastPayload?: TradingPortfolioDataPayload
  subscribers: Map<string, TradingPortfolioSubscriptionRecord>
}

interface AccountsCacheEntry {
  data?: PortfolioIdentity[]
  expiresAt: number
  promise?: Promise<PortfolioIdentity[]>
}

type TradingPortfolioBasePayload = {
  provider: TradingProviderId
  serviceId?: string
  workspaceId: string
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

type TradingPortfolioDataPayload =
  | TradingPortfolioAccountsPayload
  | TradingPortfolioSnapshotPayload
  | TradingPortfolioPerformancePayload

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

  async subscribe(
    socket: AuthenticatedSocket,
    payload: TradingPortfolioSubscribePayload
  ): Promise<TradingPortfolioSubscriptionInfo> {
    const userId = socket.userId
    if (!userId) throw new Error('Authentication required')

    const providerId = resolveTradingProviderId(payload.provider, payload.portfolioIdentity)
    const workspaceId = resolveWorkspaceId(payload.workspaceId)
    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      throw new Error('Workspace not found')
    }

    const channel = resolveChannel(payload.channel)
    const serviceId = resolveServiceId(
      providerId,
      payload.serviceId ??
        toPortfolioValueObject(payload.portfolioIdentity)?.serviceId
    )
    const portfolioIdentity = resolvePortfolioIdentity(
      channel,
      payload,
      providerId,
      serviceId
    )
    const window = resolvePerformanceWindow(providerId, channel, payload.window)
    const streamKey = buildStreamKey({
      userId,
      workspaceId,
      providerId,
      serviceId,
      portfolioIdentity,
      channel,
      window,
    })
    const streamState = this.getOrCreateStreamState({
      streamKey,
      userId,
      workspaceId,
      providerId,
      serviceId,
      portfolioIdentity,
      channel,
      window,
    })
    const subscriptionId = createSubscriptionId({
      streamKey,
      socketId: socket.id,
      clientSubscriptionId: payload.clientSubscriptionId,
    })
    const record: TradingPortfolioSubscriptionRecord = {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      streamKey,
      socketId: socket.id,
      socket,
      provider: providerId,
      serviceId,
      portfolioIdentity,
      workspaceId,
      channel,
      window,
    }

    streamState.subscribers.set(subscriptionId, record)
    const socketMap = this.socketSubscriptions.get(socket.id) ?? new Map()
    socketMap.set(subscriptionId, record)
    this.socketSubscriptions.set(socket.id, socketMap)

    if (streamState.lastPayload) {
      this.emitData(record, streamState.lastPayload)
    }

    this.ensurePolling(streamState, Boolean(payload.forceRefresh))

    logger.info('Trading portfolio subscription added', {
      socketId: socket.id,
      userId,
      providerId,
      serviceId,
      portfolioIdentity: redactPortfolioIdentity(portfolioIdentity),
      workspaceId,
      channel,
      window,
    })

    return {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      provider: providerId,
      serviceId,
      portfolioIdentity,
      workspaceId,
      channel,
      window,
    }
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

  refresh(socket: AuthenticatedSocket, payload: TradingPortfolioUnsubscribePayload) {
    const socketMap = this.socketSubscriptions.get(socket.id)
    if (!socketMap || socketMap.size === 0) return []

    const matches = this.findMatchingSubscriptions(socketMap, payload)
    const streamKeys = new Set(matches.map((record) => record.streamKey))
    streamKeys.forEach((streamKey) => {
      const state = this.streams.get(streamKey)
      if (state) void this.pollState(state, true)
    })

    return matches.map(toSubscriptionInfo)
  }

  removeSocket(socketId: string) {
    const socketMap = this.socketSubscriptions.get(socketId)
    if (!socketMap) return

    socketMap.forEach((record) => this.removeRecord(record))
  }

  private getOrCreateStreamState(
    config: Omit<TradingPortfolioStreamState, 'subscribers'>
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
    if (!streamState.pollingTimer) {
      const intervalMs = CHANNEL_POLL_INTERVAL_MS[streamState.channel]
      streamState.pollingTimer = setInterval(() => {
        void this.pollState(streamState, false)
      }, intervalMs)
      streamState.pollingTimer.unref?.()
    }

    if (forceRefresh || !streamState.lastPayload) {
      void this.pollState(streamState, forceRefresh)
    }
  }

  private async pollState(streamState: TradingPortfolioStreamState, forceRefresh: boolean) {
    if (streamState.pollingInFlight) return
    if (streamState.subscribers.size === 0) return

    streamState.pollingInFlight = true
    try {
      if (streamState.channel === 'accounts') {
        const portfolioIdentities = await this.getAccounts(streamState, forceRefresh)
        const payload: TradingPortfolioAccountsPayload = {
          provider: streamState.providerId,
          serviceId: streamState.serviceId,
          workspaceId: streamState.workspaceId,
          channel: 'accounts',
          portfolioIdentities,
          receivedAt: new Date().toISOString(),
        }
        streamState.lastPayload = payload
        this.emitToSubscribers(streamState, payload)
        return
      }

      const context = await resolveTradingPortfolioContext(streamState)
      const portfolioIdentity = await this.getSelectedPortfolioIdentity(streamState, forceRefresh)

      if (streamState.channel === 'account-snapshot') {
        const portfolioDetail = await getPortfolioDetail({
          providerId: context.providerId,
          credentialId: context.credentialId,
          serviceId: context.serviceId,
          environment: context.environment,
          accessToken: context.accessToken,
          accountId: portfolioIdentity.accountId,
        })
        const payload: TradingPortfolioSnapshotPayload = {
          provider: streamState.providerId,
          serviceId: streamState.serviceId,
          workspaceId: streamState.workspaceId,
          channel: 'account-snapshot',
          portfolioIdentity: toPortfolioValueObject(portfolioDetail) ?? portfolioIdentity,
          portfolioDetail,
          receivedAt: new Date().toISOString(),
        }
        streamState.lastPayload = payload
        this.emitToSubscribers(streamState, payload)
        return
      }

      if (!streamState.window) {
        throw new Error('performance window is required')
      }

      const performance = await getTradingAccountPerformance({
        providerId: context.providerId,
        credentialId: context.credentialId,
        serviceId: context.serviceId,
        environment: context.environment,
        accessToken: context.accessToken,
        accountId: portfolioIdentity.accountId,
        window: streamState.window,
      })
      const payload: TradingPortfolioPerformancePayload = {
        provider: streamState.providerId,
        serviceId: streamState.serviceId,
        workspaceId: streamState.workspaceId,
        channel: 'portfolio-performance',
        portfolioIdentity,
        window: streamState.window,
        performance,
        receivedAt: new Date().toISOString(),
      }
      streamState.lastPayload = payload
      this.emitToSubscribers(streamState, payload)
    } catch (error) {
      this.emitErrorToSubscribers(streamState, error)
    } finally {
      streamState.pollingInFlight = false
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
      requestId: streamState.streamKey,
    })
    this.accountsCache.set(cacheKey, {
      data: cached?.data,
      expiresAt: cached?.expiresAt ?? 0,
      promise,
    })

    try {
      const data = await promise
      this.accountsCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
      })
      return data
    } catch (error) {
      if (cached?.data) {
        this.accountsCache.set(cacheKey, cached)
      } else {
        this.accountsCache.delete(cacheKey)
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

  private emitToSubscribers(
    streamState: TradingPortfolioStreamState,
    payload: TradingPortfolioDataPayload
  ) {
    streamState.subscribers.forEach((record) => this.emitData(record, payload))
  }

  private emitData(
    record: TradingPortfolioSubscriptionRecord,
    payload: TradingPortfolioDataPayload
  ) {
    const basePayload = {
      ...payload,
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

  private emitErrorToSubscribers(streamState: TradingPortfolioStreamState, error: unknown) {
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
      record.socket.emit('trading-portfolio-error', {
        provider: record.provider,
        serviceId: record.serviceId,
        portfolioIdentity: record.portfolioIdentity,
        workspaceId: record.workspaceId,
        channel: record.channel,
        window: record.window,
        subscriptionId: record.subscriptionId,
        clientSubscriptionId: record.clientSubscriptionId,
        message,
      })
    })
  }

  private findMatchingSubscriptions(
    socketMap: Map<string, TradingPortfolioSubscriptionRecord>,
    payload: TradingPortfolioUnsubscribePayload
  ): TradingPortfolioSubscriptionRecord[] {
    if (payload.subscriptionId) {
      const match = socketMap.get(payload.subscriptionId)
      return match ? [match] : []
    }

    if (payload.clientSubscriptionId) {
      const matches: TradingPortfolioSubscriptionRecord[] = []
      socketMap.forEach((record) => {
        if (record.clientSubscriptionId === payload.clientSubscriptionId) matches.push(record)
      })
      return matches
    }

    const providerId = payload.provider?.trim()
    const serviceId = payload.serviceId?.trim()
    const portfolioIdentity = toPortfolioValueObject(payload.portfolioIdentity)
    const matches: TradingPortfolioSubscriptionRecord[] = []
    socketMap.forEach((record) => {
      if (providerId && record.provider !== providerId) return
      if (serviceId && record.serviceId !== serviceId) return
      if (payload.channel && record.channel !== payload.channel) return
      if (
        portfolioIdentity &&
        !arePortfolioIdentitiesEqual(record.portfolioIdentity, portfolioIdentity)
      ) {
        return
      }
      matches.push(record)
    })
    return matches
  }

  private removeRecord(record: TradingPortfolioSubscriptionRecord) {
    const socketMap = this.socketSubscriptions.get(record.socketId)
    if (socketMap) {
      socketMap.delete(record.subscriptionId)
      if (socketMap.size === 0) {
        this.socketSubscriptions.delete(record.socketId)
      }
    }

    const streamState = this.streams.get(record.streamKey)
    if (!streamState) return

    streamState.subscribers.delete(record.subscriptionId)
    if (streamState.subscribers.size === 0) {
      if (streamState.pollingTimer) {
        clearInterval(streamState.pollingTimer)
      }
      this.streams.delete(record.streamKey)
    }

    logger.info('Trading portfolio subscription removed', {
      socketId: record.socketId,
      userId: record.socket.userId,
      provider: record.provider,
      serviceId: record.serviceId,
      portfolioIdentity: redactPortfolioIdentity(record.portfolioIdentity),
      workspaceId: record.workspaceId,
      channel: record.channel,
      window: record.window,
    })
  }
}

export const tradingPortfolioStreamManager = new TradingPortfolioStreamManager()

async function resolveTradingPortfolioContext(
  streamState: TradingPortfolioStreamState
): Promise<TradingPortfolioBaseContext> {
  const providerDefinition = getTradingProviderDefinition(streamState.providerId)
  if (!providerDefinition) throw new Error('Unsupported trading provider')

  const serviceId = getTradingProviderOAuthServiceId(
    streamState.providerId,
    streamState.serviceId
  )
  if (!serviceId) throw new Error('Trading provider OAuth service is not configured')

  const credentialId = streamState.portfolioIdentity?.credentialId
  if (!credentialId) throw new Error('portfolioIdentity credential is required')

  const accessToken = await getOAuthTokenByCredentialId({
    userId: streamState.userId,
    credentialId,
    providerId: serviceId,
    requestId: streamState.streamKey,
  })
  if (!accessToken) throw new Error('Trading provider connection not found')
  const environment = getTradingProviderOAuthEnvironment(streamState.providerId, serviceId)
  if (!environment) throw new Error('Trading provider connection is not configured')

  return {
    providerId: streamState.providerId,
    credentialId,
    serviceId: serviceId,
    environment,
    accessToken,
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

function resolveWorkspaceId(workspaceId?: string) {
  const trimmed = workspaceId?.trim()
  if (!trimmed) throw new Error('workspaceId is required')
  return trimmed
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

function resolvePortfolioIdentity(
  channel: TradingPortfolioChannel,
  payload: TradingPortfolioSubscribePayload,
  providerId: TradingProviderId,
  serviceId: string
) {
  if (channel === 'accounts') return undefined
  const portfolioIdentity = toPortfolioValueObject(payload.portfolioIdentity)
  if (!portfolioIdentity) throw new Error('portfolioIdentity is required')
  if (portfolioIdentity.providerId !== providerId) {
    throw new Error('portfolioIdentity provider does not match subscription provider')
  }
  if (portfolioIdentity.serviceId !== serviceId) {
    throw new Error('portfolioIdentity credential does not match subscription credential')
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
  workspaceId: string
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
        config.workspaceId,
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
        streamState.workspaceId,
        streamState.providerId,
        streamState.serviceId ?? '',
      ].join('|')
    )
    .digest('hex')
}

function createSubscriptionId({
  streamKey,
  socketId,
  clientSubscriptionId,
}: {
  streamKey: string
  socketId: string
  clientSubscriptionId?: string
}) {
  return [streamKey, socketId, clientSubscriptionId?.trim() || randomUUID()].join(':')
}

function toSubscriptionInfo(
  record: TradingPortfolioSubscriptionRecord
): TradingPortfolioSubscriptionInfo {
  return {
    subscriptionId: record.subscriptionId,
    clientSubscriptionId: record.clientSubscriptionId,
    provider: record.provider,
    serviceId: record.serviceId,
    portfolioIdentity: record.portfolioIdentity,
    workspaceId: record.workspaceId,
    channel: record.channel,
    window: record.window,
  }
}
