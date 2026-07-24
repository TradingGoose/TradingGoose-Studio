import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'
import {
  defineWidgetContract,
  mergeParamsWithRuntime,
  projectCopilotParamsReviewBase,
  sanitizeLocalParamsByFields,
  type WidgetParamsNormalizationOptions,
} from '@/widgets/widget-contract-types'

export interface PortfolioSnapshotWidgetParams {
  provider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: { apiKey?: string; apiSecret?: string; [key: string]: unknown }
  selectedWindow?: TradingPortfolioPerformanceWindow
  runtime?: { refreshAt?: number }
}

const PORTFOLIO_FIELDS = [
  'provider',
  'serviceId',
  'marketProvider',
  'marketProviderParams',
  'marketAuth',
  'portfolioIdentity',
  'selectedWindow',
  'runtime',
] as const

export const sanitizePortfolioSnapshotParams = (
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
) => sanitizeLocalParamsByFields('portfolio_snapshot', PORTFOLIO_FIELDS, params, options)

export const portfolioSnapshotWidgetContract = defineWidgetContract({
  key: 'portfolio_snapshot',
  title: 'Portfolio',
  category: 'trading',
  description: 'Portfolio snapshot.',
  editable: true,
  editableFields: [...PORTFOLIO_FIELDS],
  linkedParamFields: [],
  defaultParams: null,
  sanitizeLocalParams: sanitizePortfolioSnapshotParams,
  mergeLocalParams: (currentParams, incomingParams) =>
    mergeParamsWithRuntime(sanitizePortfolioSnapshotParams, currentParams, incomingParams),
  projectCopilotParamsReviewBase: (currentParams, incomingParams) =>
    projectCopilotParamsReviewBase(currentParams, incomingParams, ['runtime']),
})
