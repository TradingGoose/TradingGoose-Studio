import { useMutation, useQuery } from '@tanstack/react-query'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { TradingHoldingsListingsResponse } from '@/app/api/widgets/trading/holdings-listings/route'
import type {
  QuickOrderSubmitRequest,
  QuickOrderSubmitResponse,
} from '@/app/api/widgets/trading/order/types'
import type {
  TradingPortfolioPerformanceWindow,
  UnifiedTradingAccount,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPortfolioPerformance,
} from '@/providers/trading/types'

type TradingAccountsRequest = {
  provider?: string
  credentialId?: string
  environment?: string
}

type TradingSnapshotRequest = TradingAccountsRequest & {
  accountId?: string
}

type TradingPerformanceRequest = TradingSnapshotRequest & {
  selectedWindow?: TradingPortfolioPerformanceWindow
}

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
    accounts?: UnifiedTradingAccount[]
    snapshot?: UnifiedTradingAccountSnapshot
    performance?: UnifiedTradingPortfolioPerformance
    listings?: ListingIdentity[]
    invalidPositions?: TradingHoldingsListingsResponse['invalidPositions']
    order?: QuickOrderSubmitResponse['order']
    provider?: string
    environment?: string
    accountId?: string
    message?: string | null
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`)
  }

  return payload as T
}

export const tradingPortfolioQueryKeys = {
  accounts: (request: TradingAccountsRequest) =>
    [
      'trading-portfolio',
      'accounts',
      request.provider ?? '',
      request.credentialId ?? '',
      request.environment ?? '',
    ] as const,
  snapshot: (request: TradingSnapshotRequest) =>
    [
      'trading-portfolio',
      'snapshot',
      request.provider ?? '',
      request.credentialId ?? '',
      request.environment ?? '',
      request.accountId ?? '',
    ] as const,
  performance: (request: TradingPerformanceRequest) =>
    [
      'trading-portfolio',
      'performance',
      request.provider ?? '',
      request.credentialId ?? '',
      request.environment ?? '',
      request.accountId ?? '',
      request.selectedWindow ?? '',
    ] as const,
  holdingsListings: (request: TradingSnapshotRequest) =>
    [
      'trading-portfolio',
      'holdings-listings',
      request.provider ?? '',
      request.credentialId ?? '',
      request.environment ?? '',
      request.accountId ?? '',
    ] as const,
}

export async function fetchTradingAccounts(request: TradingAccountsRequest) {
  const payload = await postJson<{ accounts?: UnifiedTradingAccount[] }>(
    '/api/widgets/trading/accounts',
    {
      provider: request.provider,
      credentialId: request.credentialId,
      environment: request.environment,
    }
  )
  return payload.accounts ?? []
}

export function useTradingAccounts(request: TradingAccountsRequest) {
  return useQuery<UnifiedTradingAccount[]>({
    queryKey: tradingPortfolioQueryKeys.accounts(request),
    queryFn: () => fetchTradingAccounts(request),
    enabled: Boolean(request.provider && request.credentialId && request.environment),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useTradingPortfolioSnapshot(request: TradingSnapshotRequest) {
  return useQuery<UnifiedTradingAccountSnapshot>({
    queryKey: tradingPortfolioQueryKeys.snapshot(request),
    queryFn: async () => {
      const payload = await postJson<{ snapshot: UnifiedTradingAccountSnapshot }>(
        '/api/widgets/trading/snapshot',
        {
          provider: request.provider,
          credentialId: request.credentialId,
          environment: request.environment,
          accountId: request.accountId,
        }
      )
      return payload.snapshot
    },
    enabled: Boolean(
      request.provider && request.credentialId && request.environment && request.accountId
    ),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useTradingHoldingsListings(request: TradingSnapshotRequest) {
  return useQuery<TradingHoldingsListingsResponse>({
    queryKey: tradingPortfolioQueryKeys.holdingsListings(request),
    queryFn: async () => {
      const payload = await postJson<{
        listings?: ListingIdentity[]
        invalidPositions?: TradingHoldingsListingsResponse['invalidPositions']
      }>('/api/widgets/trading/holdings-listings', {
        provider: request.provider,
        credentialId: request.credentialId,
        environment: request.environment,
        accountId: request.accountId,
      })
      return {
        listings: payload.listings ?? [],
        invalidPositions: payload.invalidPositions ?? [],
      }
    },
    enabled: Boolean(
      request.provider && request.credentialId && request.environment && request.accountId
    ),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useTradingPortfolioPerformance(request: TradingPerformanceRequest) {
  return useQuery<UnifiedTradingPortfolioPerformance>({
    queryKey: tradingPortfolioQueryKeys.performance(request),
    queryFn: async () => {
      const payload = await postJson<{ performance: UnifiedTradingPortfolioPerformance }>(
        '/api/widgets/trading/performance',
        {
          provider: request.provider,
          credentialId: request.credentialId,
          environment: request.environment,
          accountId: request.accountId,
          window: request.selectedWindow,
        }
      )
      return payload.performance
    },
    enabled: Boolean(
      request.provider &&
        request.credentialId &&
        request.environment &&
        request.accountId &&
        request.selectedWindow
    ),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useSubmitTradingOrder() {
  return useMutation<QuickOrderSubmitResponse, Error, QuickOrderSubmitRequest>({
    mutationFn: (request) =>
      postJson<QuickOrderSubmitResponse>('/api/widgets/trading/order', request),
  })
}
