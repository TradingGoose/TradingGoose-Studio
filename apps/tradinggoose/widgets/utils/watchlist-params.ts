import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const sanitizeWatchlistParams = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!params || !isRecord(params)) return null

  const provider = normalizeString(params.provider)
  const watchlistId = normalizeString(params.watchlistId)
  const providerParams = sanitizeMarketProviderParamsForWidget(provider, params.providerParams)
  const auth = sanitizeMarketProviderAuth(params.auth)
  const runtime = isRecord(params.runtime) ? params.runtime : null
  const refreshAt =
    typeof runtime?.refreshAt === 'number' && Number.isFinite(runtime.refreshAt)
      ? runtime.refreshAt
      : undefined

  const nextParams: Record<string, unknown> = {}
  if (watchlistId) nextParams.watchlistId = watchlistId
  if (provider) nextParams.provider = provider
  if (providerParams) nextParams.providerParams = providerParams
  if (auth) nextParams.auth = auth
  if (refreshAt !== undefined) nextParams.runtime = { refreshAt }

  return Object.keys(nextParams).length > 0 ? nextParams : null
}

export const sanitizeWatchlistRuntimeParams = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  return sanitizeWatchlistParams(params)
}

export const mergeWatchlistParams = (
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
) => {
  const currentRuntime = isRecord(currentParams?.runtime) ? currentParams.runtime : null
  const incomingRuntime = isRecord(incomingParams.runtime) ? incomingParams.runtime : null
  const mergedRuntime =
    currentRuntime || incomingRuntime
      ? {
          ...(currentRuntime ?? {}),
          ...(incomingRuntime ?? {}),
        }
      : undefined

  return sanitizeWatchlistParams({
    ...(currentParams ?? {}),
    ...incomingParams,
    ...(mergedRuntime ? { runtime: mergedRuntime } : {}),
  })
}
