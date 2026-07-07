import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import {
  defineWidgetContract,
  sanitizeLocalParamsByFields,
  type WidgetParamsNormalizationOptions,
} from '@/widgets/widget-contract-types'

export type QuickOrderSide = 'buy' | 'sell'

export interface QuickOrderWidgetParams {
  provider?: string
  serviceId?: string
  portfolioIdentity?: PortfolioIdentity
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: { apiKey?: string; apiSecret?: string; [key: string]: unknown }
  side?: QuickOrderSide
}

const QUICK_ORDER_FIELDS = [
  'provider',
  'serviceId',
  'marketProvider',
  'marketProviderParams',
  'marketAuth',
  'portfolioIdentity',
  'side',
] as const

export const sanitizeQuickOrderParams = (
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
) => sanitizeLocalParamsByFields('quick_order', QUICK_ORDER_FIELDS, params, options)

export const quickOrderWidgetContract = defineWidgetContract({
  key: 'quick_order',
  title: 'Quick Order',
  category: 'trading',
  description: 'Place quick trading orders.',
  editable: true,
  editableFields: [...QUICK_ORDER_FIELDS],
  linkedParamFields: [],
  defaultParams: null,
  sanitizeLocalParams: sanitizeQuickOrderParams,
  mergeLocalParams: (currentParams, incomingParams) =>
    sanitizeQuickOrderParams(
      { ...(currentParams ?? {}), ...incomingParams },
      { strictUnknown: true }
    ),
  examples: [{ widgetKey: 'quick_order', params: { side: 'buy' } }],
  bestPractices: ['Keep order-entry and account details widget-local.'],
  validationHints: ['side must be buy or sell when provided.'],
})
