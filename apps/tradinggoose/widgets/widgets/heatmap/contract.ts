import type { ListingIdentity } from '@/lib/listing/identity'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import {
  defineWidgetContract,
  mergeParamsWithRuntime,
  projectCopilotParamsReviewBase,
  sanitizeLocalParamsByFields,
  type WidgetParamsNormalizationOptions,
} from '@/widgets/widget-contract-types'

export type HeatmapSourceMode = 'watchlist' | 'portfolio'
export type HeatmapWatchlistSizeMetric = 'volume' | 'volumeUsd'

export interface HeatmapWidgetParams {
  listing?: ListingIdentity | null
  sourceMode?: HeatmapSourceMode
  watchlistSizeMetric?: HeatmapWatchlistSizeMetric
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: { apiKey?: string; apiSecret?: string; [key: string]: unknown }
  tradingProvider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  runtime?: { refreshAt?: number }
}

const HEATMAP_FIELDS = [
  'listing',
  'sourceMode',
  'watchlistSizeMetric',
  'marketProvider',
  'marketProviderParams',
  'marketAuth',
  'tradingProvider',
  'serviceId',
  'portfolioIdentity',
  'runtime',
] as const

export const sanitizeHeatmapParams = (
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
) => sanitizeLocalParamsByFields('heatmap', HEATMAP_FIELDS, params, options)

export const heatmapWidgetContract = defineWidgetContract({
  key: 'heatmap',
  title: 'Heatmap',
  category: 'trading',
  description: 'Market heatmap for a selected listing/watchlist/portfolio source.',
  editable: true,
  editableFields: [...HEATMAP_FIELDS],
  linkedParamFields: ['listing'],
  defaultParams: null,
  sanitizeLocalParams: sanitizeHeatmapParams,
  mergeLocalParams: (currentParams, incomingParams) =>
    mergeParamsWithRuntime(sanitizeHeatmapParams, currentParams, incomingParams),
  projectCopilotParamsReviewBase: (currentParams, incomingParams) =>
    projectCopilotParamsReviewBase(currentParams, incomingParams, ['runtime']),
})
