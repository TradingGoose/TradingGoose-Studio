import { createHash, randomUUID } from 'crypto'
import { getListingIdentityKey } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { resolveTradingPositionListingIdentity } from '@/providers/trading/listing-resolution'
import {
  getTradingAccountPerformance,
  getTradingAccountSnapshot,
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
  listTradingAccounts,
} from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type {
  TradingPortfolioBaseContext,
  TradingPortfolioPerformanceWindow,
  TradingProviderId,
  UnifiedTradingAccount,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPositionListings,
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
  workspaceId?: string
  accountId?: string
  window?: TradingPortfolioPerformanceWindow
  channel?: TradingPortfolioChannel
  clientSubscriptionId?: string
  forceRefresh?: boolean
}

export interface TradingPortfolioUnsubscribePayload {
  subscriptionId?: string
  clientSubscriptionId?: string
  provider?: string
  channel?: TradingPortfolioChannel
  accountId?: string
}

export interface TradingPortfolioSubscriptionInfo {
  subscriptionId: string
  clientSubscriptionId?: string
  provider: TradingProviderId
  workspaceId: string
  channel: TradingPortfolioChannel
  accountId?: string
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
  channel: TradingPortfolioChannel
  accountId?: string
  window?: TradingPortfolioPerformanceWindow
  pollingTimer?: ReturnType<typeof setInterval>
  pollingInFlight?: boolean
  lastPayload?: TradingPortfolioDataPayload
  subscribers: Map<string, TradingPortfolioSubscriptionRecord>
}

interface AccountsCacheEntry {
  data?: UnifiedTradingAccount[]
  expiresAt: number
  promise?: Promise<UnifiedTradingAccount[]>
}

type TradingPortfolioBasePayload = {
  provider: TradingProviderId
  workspaceId: string
  channel: TradingPortfolioChannel
  receivedAt: string
}

type TradingPortfolioAccountsPayload = TradingPortfolioBasePayload & {
  channel: 'accounts'
  accounts: UnifiedTradingAccount[]
}

type TradingPortfolioSnapshotPayload = TradingPortfolioBasePayload & {
  channel: 'account-snapshot'
  accountId: string
  snapshot: UnifiedTradingAccountSnapshot
  positionListings: UnifiedTradingPositionListings['positionListings']
}

type TradingPortfolioPerformancePayload = TradingPortfolioBasePayload & {
  channel: 'portfolio-performance'
  accountId: string
  window: TradingPortfolioPerformanceWindow
  performance: Awaited<ReturnType<typeof getTradingAccountPerformance>>
}

type TradingPortfolioDataPayload =
  | TradingPortfolioAccountsPayload
  | TradingPortfolioSnapshotPayload
  | TradingPortfolioPerformancePayload

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export async function buildTradingPositionListings(
  snapshot: UnifiedTradingAccountSnapshot
): Promise<UnifiedTradingPositionListings['positionListings']> {
  const positionListingsByKey = new Map<
    string,
    UnifiedTradingPositionListings['positionListings'][number]
  >()

  for (const position of snapshot.positions) {
    const listing = await resolveTradingPositionListingIdentity(position.symbol)
    if (!listing) continue

    const key = getListingIdentityKey(listing)
    const multiplier = isFiniteNumber(position.multiplier) ? position.multiplier : 1
    const conversionRate = isFiniteNumber(position.conversionRate) ? position.conversionRate : 1
    const quantity = isFiniteNumber(position.quantity) ? position.quantity : 0
    const signedQuantity = quantity * multiplier * conversionRate
    const grossQuantity = Math.abs(signedQuantity)
    const current = positionListingsByKey.get(key)

    if (current) {
      current.grossQuantity += grossQuantity
      current.signedQuantity += signedQuantity
      continue
    }

    positionListingsByKey.set(key, {
      listing,
      grossQuantity,
      signedQuantity,
    })
  }

  return Array.from(positionListingsByKey.values())
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

    const providerId = resolveTradingProviderId(payload.provider)
    const workspaceId = resolveWorkspaceId(payload.workspaceId)
    const channel = resolveChannel(payload.channel)
    const accountId = resolveAccountId(channel, payload.accountId)
    const window = resolvePerformanceWindow(providerId, channel, payload.window)
    const streamKey = buildStreamKey({
      userId,
      workspaceId,
      providerId,
      channel,
      accountId,
      window,
    })
    const streamState = this.getOrCreateStreamState({
      streamKey,
      userId,
      workspaceId,
      providerId,
      channel,
      accountId,
      window,
    })
    const subscriptionId = createSubscriptionId({
      streamKey,
      clientSubscriptionId: payload.clientSubscriptionId,
    })
    const record: TradingPortfolioSubscriptionRecord = {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      streamKey,
      socketId: socket.id,
      socket,
      provider: providerId,
      workspaceId,
      channel,
      accountId,
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
      workspaceId,
      channel,
      accountId,
      window,
    })

    return {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      provider: providerId,
      workspaceId,
      channel,
      accountId,
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
      const context = await resolveTradingPortfolioContext(streamState)

      if (streamState.channel === 'accounts') {
        const accounts = await this.getAccounts(streamState, context, forceRefresh)
        const payload: TradingPortfolioAccountsPayload = {
          provider: streamState.providerId,
          workspaceId: streamState.workspaceId,
          channel: 'accounts',
          accounts,
          receivedAt: new Date().toISOString(),
        }
        streamState.lastPayload = payload
        this.emitToSubscribers(streamState, payload)
        return
      }

      const account = await this.getSelectedAccount(streamState, context, forceRefresh)

      if (streamState.channel === 'account-snapshot') {
        const rawSnapshot = await getTradingAccountSnapshot({
          providerId: context.providerId,
          environment: context.environment,
          accessToken: context.accessToken,
          accountId: account.id,
        })
        const snapshot = {
          ...rawSnapshot,
          account: mergeSnapshotAccountMetadata({
            snapshot: rawSnapshot,
            selectedAccount: account,
          }),
        }
        const positionListings = await buildTradingPositionListings(snapshot)
        const payload: TradingPortfolioSnapshotPayload = {
          provider: streamState.providerId,
          workspaceId: streamState.workspaceId,
          channel: 'account-snapshot',
          accountId: account.id,
          snapshot,
          positionListings,
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
        environment: context.environment,
        accessToken: context.accessToken,
        accountId: account.id,
        window: streamState.window,
      })
      const payload: TradingPortfolioPerformancePayload = {
        provider: streamState.providerId,
        workspaceId: streamState.workspaceId,
        channel: 'portfolio-performance',
        accountId: account.id,
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
    context: TradingPortfolioBaseContext,
    forceRefresh: boolean
  ): Promise<UnifiedTradingAccount[]> {
    const cacheKey = buildAccountsCacheKey(streamState)
    const cached = this.accountsCache.get(cacheKey)
    const now = Date.now()

    if (!forceRefresh && cached?.data && cached.expiresAt > now) {
      return cached.data
    }

    if (!forceRefresh && cached?.promise) {
      return cached.promise
    }

    const promise = listTradingAccounts(context)
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

  private async getSelectedAccount(
    streamState: TradingPortfolioStreamState,
    context: TradingPortfolioBaseContext,
    forceRefresh: boolean
  ) {
    const accountId = streamState.accountId
    if (!accountId) throw new Error('accountId is required')

    const accounts = await this.getAccounts(streamState, context, forceRefresh)
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('Account not found for provider connection')
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
        url: error.url,
        payload: error.payload,
        error: error.message,
      })
    } else {
      logger.error('Trading portfolio poll failed', {
        providerId: streamState.providerId,
        channel: streamState.channel,
        accountId: streamState.accountId,
        error: message,
      })
    }

    streamState.subscribers.forEach((record) => {
      record.socket.emit('trading-portfolio-error', {
        provider: record.provider,
        workspaceId: record.workspaceId,
        channel: record.channel,
        accountId: record.accountId,
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
    const matches: TradingPortfolioSubscriptionRecord[] = []
    socketMap.forEach((record) => {
      if (providerId && record.provider !== providerId) return
      if (payload.channel && record.channel !== payload.channel) return
      if (payload.accountId && record.accountId !== payload.accountId.trim()) return
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
      workspaceId: record.workspaceId,
      channel: record.channel,
      accountId: record.accountId,
      window: record.window,
    })
  }
}

export const tradingPortfolioStreamManager = new TradingPortfolioStreamManager()

async function resolveTradingPortfolioContext(
  streamState: TradingPortfolioStreamState
): Promise<TradingPortfolioBaseContext> {
  const serviceId = getTradingProviderOAuthServiceId(streamState.providerId)
  if (!serviceId) throw new Error('Trading provider OAuth service is not configured')

  const accessToken = await getOAuthToken(streamState.userId, serviceId)
  if (!accessToken) throw new Error('Trading provider connection not found')

  return {
    providerId: streamState.providerId,
    environment: 'live',
    accessToken,
  }
}

function resolveTradingProviderId(provider?: string): TradingProviderId {
  const providerId = provider?.trim()
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

function resolveAccountId(channel: TradingPortfolioChannel, accountId?: string) {
  if (channel === 'accounts') return undefined
  const trimmed = accountId?.trim()
  if (!trimmed) throw new Error('accountId is required')
  return trimmed
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
  channel: TradingPortfolioChannel
  accountId?: string
  window?: TradingPortfolioPerformanceWindow
}) {
  return createHash('sha256')
    .update(
      [
        config.userId,
        config.workspaceId,
        config.providerId,
        config.channel,
        config.accountId ?? '',
        config.window ?? '',
      ].join('|')
    )
    .digest('hex')
}

function buildAccountsCacheKey(streamState: TradingPortfolioStreamState) {
  return createHash('sha256')
    .update([streamState.userId, streamState.workspaceId, streamState.providerId].join('|'))
    .digest('hex')
}

function createSubscriptionId({
  streamKey,
  clientSubscriptionId,
}: {
  streamKey: string
  clientSubscriptionId?: string
}) {
  return [streamKey, clientSubscriptionId?.trim() || randomUUID()].join(':')
}

function mergeSnapshotAccountMetadata({
  snapshot,
  selectedAccount,
}: {
  snapshot: UnifiedTradingAccountSnapshot
  selectedAccount: UnifiedTradingAccount
}) {
  return {
    ...snapshot.account,
    id: selectedAccount.id,
    name: snapshot.account.name ?? selectedAccount.name,
    type: snapshot.account.type === 'unknown' ? selectedAccount.type : snapshot.account.type,
    baseCurrency: snapshot.account.baseCurrency || selectedAccount.baseCurrency,
    status:
      !snapshot.account.status || snapshot.account.status === 'unknown'
        ? selectedAccount.status
        : snapshot.account.status,
  }
}

function toSubscriptionInfo(
  record: TradingPortfolioSubscriptionRecord
): TradingPortfolioSubscriptionInfo {
  return {
    subscriptionId: record.subscriptionId,
    clientSubscriptionId: record.clientSubscriptionId,
    provider: record.provider,
    workspaceId: record.workspaceId,
    channel: record.channel,
    accountId: record.accountId,
    window: record.window,
  }
}
