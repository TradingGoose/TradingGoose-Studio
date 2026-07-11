import type { ListingIdentity } from '@/lib/listing/identity'
import {
  defineWidgetContract,
  mergeParamsWithRuntime,
  projectLocalParamsReviewBase,
  sanitizeLocalParamsByFields,
  type WidgetParamsNormalizationOptions,
} from '@/widgets/widget-contract-types'

export type WatchlistWidgetParams = {
  watchlistId?: string | null
  listing?: ListingIdentity | null
  provider?: string
  providerParams?: Record<string, unknown>
  auth?: { apiKey?: string; apiSecret?: string }
  runtime?: { refreshAt?: number }
}

const WATCHLIST_FIELDS = [
  'watchlistId',
  'listing',
  'provider',
  'providerParams',
  'auth',
  'runtime',
] as const

export const sanitizeWatchlistParams = (
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
) => sanitizeLocalParamsByFields('watchlist', WATCHLIST_FIELDS, params, options)

export const mergeWatchlistParams = (
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
) => mergeParamsWithRuntime(sanitizeWatchlistParams, currentParams, incomingParams)

export const watchlistWidgetContract = defineWidgetContract({
  key: 'watchlist',
  title: 'Watchlist',
  category: 'trading',
  description: 'Manage symbol watchlists.',
  editable: true,
  editableFields: [...WATCHLIST_FIELDS],
  linkedParamFields: ['watchlistId', 'listing'],
  defaultParams: null,
  sanitizeLocalParams: sanitizeWatchlistParams,
  mergeLocalParams: mergeWatchlistParams,
  projectLocalParamsReviewBase: (currentParams, incomingParams) =>
    projectLocalParamsReviewBase(currentParams, incomingParams, ['runtime']),
})
