import { z } from 'zod'
import type { ListingIdentity } from '@/lib/listing/identity'
import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import {
  defineWidgetContract,
  isRecord,
  projectCopilotParamsReviewBase,
  sanitizeLocalParamsByFields,
  WidgetContractValidationError,
  type WidgetParamsNormalizationOptions,
} from '@/widgets/widget-contract-types'
import type { ManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/owner-snapshot'

const DataChartCandleTypeSchema = z.enum([
  'candle_solid',
  'candle_stroke',
  'candle_up_stroke',
  'candle_down_stroke',
  'ohlc',
  'area',
])

const IndicatorRefSchema = z
  .object({
    id: z.string().trim().min(1),
    inputs: z.record(z.unknown()).optional(),
    visible: z.boolean().optional(),
  })
  .strict()

export type DataChartCandleType = z.infer<typeof DataChartCandleTypeSchema>
export type IndicatorRef = z.infer<typeof IndicatorRefSchema>

export type DrawToolsRef = {
  id: string
  pane: 'price' | 'indicator'
  indicatorId?: string
  snapshot?: ManualOwnerSnapshot
}

const DataChartDataSchema = z
  .object({
    provider: z.string().optional(),
    providerParams: z.record(z.unknown()).optional(),
    auth: z.record(z.unknown()).optional(),
    live: z
      .object({ enabled: z.boolean().optional(), interval: z.string().optional() })
      .strict()
      .optional(),
  })
  .passthrough()

const DataChartViewSchema = z
  .object({
    locale: z.string().optional(),
    timezone: z.string().optional(),
    start: z.number().finite().optional(),
    end: z.number().finite().optional(),
    interval: z.string().optional(),
    marketSession: z.enum(['regular', 'extended']).optional(),
    pricePrecision: z.number().finite().optional(),
    volumePrecision: z.number().finite().optional(),
    candleType: DataChartCandleTypeSchema.optional(),
    priceAxisType: z.enum(['normal', 'percentage', 'log']).optional(),
    pineIndicators: z.array(IndicatorRefSchema).optional(),
    rangePresetId: z.string().optional(),
    stylesOverride: z.record(z.unknown()).optional(),
  })
  .passthrough()

export type DataChartDataParams = z.infer<typeof DataChartDataSchema>
export type DataChartViewParams = z.infer<typeof DataChartViewSchema> & {
  drawTools?: DrawToolsRef[]
}

export type DataChartWidgetParams = {
  listing?: ListingIdentity | null
  data?: DataChartDataParams
  view?: DataChartViewParams
  runtime?: {
    refreshAt?: number
  }
}

const DATA_CHART_FIELDS = ['listing', 'data', 'view', 'runtime'] as const

const DATA_CHART_COPILOT_VIEW_FIELDS = new Set(Object.keys(DataChartViewSchema.shape))

function sanitizeDataChartFields(
  value: Record<string, unknown>,
  fields: Record<string, z.ZodTypeAny>,
  path: 'data' | 'view',
  options: WidgetParamsNormalizationOptions
): Record<string, unknown> {
  const normalized = { ...value }
  for (const [field, schema] of Object.entries(fields)) {
    if (!Object.hasOwn(value, field)) continue
    if (value[field] == null) {
      delete normalized[field]
      continue
    }
    const parsed = schema.safeParse(value[field])
    if (parsed.success) {
      normalized[field] = parsed.data
      continue
    }
    delete normalized[field]
    if (options.strictUnknown) {
      throw new WidgetContractValidationError(
        parsed.error.issues.map((issue) => ({
          path: [`params.${path}.${field}`, ...issue.path].join('.'),
          message: issue.message,
        }))
      )
    }
  }
  return normalized
}

export const sanitizeDataChartParams = (
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
): Record<string, unknown> | null => {
  if (params == null) return null
  if (!isRecord(params)) {
    throw new Error('Widget "data_chart" params must be an object or null')
  }
  const normalized = sanitizeLocalParamsByFields('data_chart', DATA_CHART_FIELDS, params, options)
  if (!normalized) return null

  const data = isRecord(normalized.data)
    ? sanitizeDataChartFields(normalized.data, DataChartDataSchema.shape, 'data', options)
    : null
  if (data) {
    const provider = typeof data.provider === 'string' ? data.provider.trim() : ''
    const providerParams = sanitizeMarketProviderParamsForWidget(provider, data.providerParams)
    const auth = sanitizeMarketProviderAuth(data.auth)
    const { provider: _provider, providerParams: _providerParams, auth: _auth, ...nextData } = data

    if (provider) nextData.provider = provider
    if (providerParams) nextData.providerParams = providerParams
    if (auth) nextData.auth = auth
    normalized.data = Object.keys(nextData).length > 0 ? nextData : undefined
  }

  if (isRecord(normalized.view)) {
    const view = sanitizeDataChartFields(
      normalized.view,
      DataChartViewSchema.shape,
      'view',
      options
    )
    normalized.view = view
  }

  const nextParams = Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  )
  return Object.keys(nextParams).length > 0 ? nextParams : null
}

export const mergeDataChartParams = (
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
): Record<string, unknown> | null => {
  const merged = {
    ...(currentParams ?? {}),
    ...incomingParams,
  }

  for (const field of ['data', 'view', 'runtime'] as const) {
    if (isRecord(incomingParams[field])) {
      merged[field] = {
        ...(isRecord(currentParams?.[field]) ? currentParams[field] : {}),
        ...incomingParams[field],
      }
    }
  }

  return sanitizeDataChartParams(merged, { strictUnknown: true })
}

function projectDataChartParamsForCopilot(
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const normalized = sanitizeDataChartParams(params, { strictUnknown: false })
  if (!normalized) return null
  const { view, ...projected } = normalized
  if (isRecord(view)) {
    const visibleView = Object.fromEntries(
      Object.entries(view).filter(([field]) => DATA_CHART_COPILOT_VIEW_FIELDS.has(field))
    )
    if (Object.keys(visibleView).length > 0) projected.view = visibleView
  }
  return Object.keys(projected).length > 0 ? projected : null
}

function preserveDataChartDrawTools(
  currentParams: Record<string, unknown> | null | undefined,
  params: Record<string, unknown> | null
): Record<string, unknown> | null {
  const currentView = isRecord(currentParams?.view) ? currentParams.view : null
  if (!currentView || !Object.hasOwn(currentView, 'drawTools')) return params
  return {
    ...(params ?? {}),
    view: {
      ...(isRecord(params?.view) ? params.view : {}),
      drawTools: currentView.drawTools,
    },
  }
}

function mergeDataChartCopilotParams(
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown> | null
): Record<string, unknown> | null {
  const incomingView = isRecord(incomingParams?.view) ? incomingParams.view : null
  const hiddenFields = incomingView
    ? Object.keys(incomingView).filter((field) => !DATA_CHART_COPILOT_VIEW_FIELDS.has(field))
    : []
  if (hiddenFields.length > 0) {
    throw new WidgetContractValidationError(
      hiddenFields.map((field) => ({
        path: `params.view.${field}`,
        message: 'Widget "data_chart" does not expose this field to Copilot',
      }))
    )
  }
  return preserveDataChartDrawTools(
    currentParams,
    incomingParams === null ? null : mergeDataChartParams(currentParams, incomingParams)
  )
}

export const dataChartWidgetContract = defineWidgetContract({
  key: 'data_chart',
  title: 'Chart',
  category: 'trading',
  description: 'Market chart for a selected listing. Drawing state is managed by the chart UI.',
  editable: true,
  editableFields: [...DATA_CHART_FIELDS],
  linkedParamFields: ['listing'],
  defaultParams: null,
  sanitizeLocalParams: sanitizeDataChartParams,
  mergeLocalParams: mergeDataChartParams,
  projectCopilotParams: projectDataChartParamsForCopilot,
  mergeCopilotParams: mergeDataChartCopilotParams,
  projectCopilotParamsReviewBase: (currentParams, incomingParams) =>
    projectCopilotParamsReviewBase(currentParams, incomingParams, ['data', 'view', 'runtime']),
})
