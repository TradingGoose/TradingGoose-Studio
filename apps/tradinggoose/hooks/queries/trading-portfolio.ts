import { useQuery } from '@tanstack/react-query'
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

const postJson = async <T>(url: string, body: Record<string, unknown>): Promise<T> => {
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
}

export function useTradingAccounts(request: TradingAccountsRequest) {
  return useQuery<UnifiedTradingAccount[]>({
    queryKey: tradingPortfolioQueryKeys.accounts(request),
    queryFn: async () => {
      const payload = await postJson<{ accounts?: UnifiedTradingAccount[] }>(
        '/api/widgets/trading/accounts',
        {
          provider: request.provider,
          credentialId: request.credentialId,
          environment: request.environment,
        }
      )
      return payload.accounts ?? []
    },
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
