import type { ListingIdentity } from '@/lib/listing/identity'
import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import type { MarketInterval } from '@/providers/market/types'
import {
  assertKnownWidgetParamFields,
  defineWidgetContract,
  FIELD_CONTRACTS,
  isRecord,
  sanitizeLocalParamsByFields,
  type WidgetParamFieldContract,
  type WidgetParamsNormalizationOptions,
  type WidgetReferenceParamCandidate,
} from '@/widgets/widget-contract-types'
import type { ManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/owner-snapshot'
import { normalizeManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/owner-snapshot'

export type DataChartCandleType =
  | 'candle_solid'
  | 'candle_stroke'
  | 'candle_up_stroke'
  | 'candle_down_stroke'
  | 'ohlc'
  | 'area'

export type IndicatorRef = {
  id: string
  inputs?: Record<string, unknown>
  visible?: boolean
}

export type DrawToolsRef = {
  id: string
  pane: 'price' | 'indicator'
  indicatorId?: string
  snapshot?: ManualOwnerSnapshot
}

export type DataChartAuthParams = {
  apiKey?: string
  apiSecret?: string
  [key: string]: unknown
}

export type DataChartDataParams = {
  provider?: string
  providerParams?: Record<string, unknown>
  auth?: DataChartAuthParams
  live?: {
    enabled?: boolean
    interval?: MarketInterval | string
  }
}

export type DataChartViewParams = {
  locale?: string
  timezone?: string
  start?: number
  end?: number
  interval?: MarketInterval | string
  marketSession?: 'regular' | 'extended'
  pricePrecision?: number
  volumePrecision?: number
  candleType?: DataChartCandleType
  priceAxisType?: 'normal' | 'percentage' | 'log'
  pineIndicators?: IndicatorRef[]
  drawTools?: DrawToolsRef[]
  rangePresetId?: string
  stylesOverride?: Record<string, unknown>
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

const childField = (
  field: string,
  kind: WidgetParamFieldContract['kind'],
  description: string,
  extra: Omit<WidgetParamFieldContract, 'field' | 'kind' | 'description'> = {}
): WidgetParamFieldContract => ({ field, kind, description, ...extra })

const withChildren = (
  base: WidgetParamFieldContract,
  description: string,
  children: WidgetParamFieldContract[]
): WidgetParamFieldContract => ({ ...base, description, children })

const DATA_CHART_PARAM_CONTRACT: WidgetParamFieldContract[] = [
  FIELD_CONTRACTS.listing,
  withChildren(FIELD_CONTRACTS.data, 'Data chart market-data settings.', [
    childField('data.provider', 'string', 'Market-data provider id, for example alpaca.'),
    childField('data.providerParams', 'record', 'Provider-specific settings such as feed.'),
    childField('data.auth', 'record', 'Market-data credentials or env-var placeholders.'),
    childField('data.live.enabled', 'json', 'Whether live-bar refresh is enabled.'),
    childField('data.live.interval', 'string', 'Live refresh interval.'),
  ]),
  withChildren(FIELD_CONTRACTS.view, 'Data chart view, indicator, range, and drawing settings.', [
    childField('view.interval', 'string', 'Market data candle interval.'),
    childField('view.marketSession', 'enum', 'Market session displayed by the chart.', {
      allowedValues: ['regular', 'extended'],
    }),
    childField('view.timezone', 'string', 'Chart timezone override.'),
    childField('view.start', 'json', 'Visible range start timestamp in ms.'),
    childField('view.end', 'json', 'Visible range end timestamp in ms.'),
    childField('view.candleType', 'enum', 'Chart price series rendering style.', {
      allowedValues: [
        'candle_solid',
        'candle_stroke',
        'candle_up_stroke',
        'candle_down_stroke',
        'ohlc',
        'area',
      ],
    }),
    childField('view.priceAxisType', 'enum', 'Chart price-axis scale mode.', {
      allowedValues: ['normal', 'percentage', 'log'],
    }),
    childField('view.pineIndicators', 'json', 'Ordered indicator refs rendered on the chart.', {
      children: [
        childField(
          'view.pineIndicators[].id',
          'entity-reference',
          'Indicator id from list_indicators.',
          {
            referenceKind: 'indicator',
          }
        ),
        childField('view.pineIndicators[].inputs', 'record', 'Indicator input overrides.'),
        childField('view.pineIndicators[].visible', 'json', 'False hides without removing.'),
      ],
    }),
    childField('view.drawTools', 'json', 'Manual drawing owner refs and snapshots.', {
      children: [
        childField(
          'view.drawTools[].indicatorId',
          'entity-reference',
          'Indicator id for indicator-pane drawings.',
          {
            referenceKind: 'indicator',
          }
        ),
      ],
    }),
    childField('view.rangePresetId', 'string', 'Chart range preset id.'),
    childField('view.stylesOverride', 'record', 'Chart style override object.'),
  ]),
  FIELD_CONTRACTS.runtime,
]

const normalizeDrawToolsSnapshotById = (raw: unknown): Map<string, ManualOwnerSnapshot> => {
  if (!Array.isArray(raw)) return new Map()

  const snapshotById = new Map<string, ManualOwnerSnapshot>()
  raw.forEach((entry) => {
    if (!isRecord(entry)) return
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) return
    const snapshot = normalizeManualOwnerSnapshot(entry.snapshot)
    if (!snapshot) return
    snapshotById.set(id, snapshot)
  })
  return snapshotById
}

const mergeDrawToolsSnapshots = (
  currentDrawTools: unknown,
  incomingDrawTools: unknown
): unknown => {
  if (!Array.isArray(incomingDrawTools)) return incomingDrawTools
  if (!Array.isArray(currentDrawTools)) return incomingDrawTools

  const snapshotById = normalizeDrawToolsSnapshotById(currentDrawTools)
  if (snapshotById.size === 0) return incomingDrawTools

  let changed = false
  const merged = incomingDrawTools.map((entry) => {
    if (!isRecord(entry)) return entry

    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) return entry

    if (Object.hasOwn(entry, 'snapshot')) return entry
    if (normalizeManualOwnerSnapshot(entry.snapshot) !== null) return entry

    const snapshot = snapshotById.get(id)
    if (snapshot === undefined) return entry

    changed = true
    return { ...entry, snapshot }
  })

  return changed ? merged : incomingDrawTools
}

export const sanitizeDataChartParams = (
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
): Record<string, unknown> | null => {
  if (params == null) return null
  if (!isRecord(params)) {
    throw new Error('Widget "data_chart" params must be an object or null')
  }
  assertKnownWidgetParamFields('data_chart', DATA_CHART_FIELDS, params, options)

  const normalized = sanitizeLocalParamsByFields('data_chart', DATA_CHART_FIELDS, params, {
    strictUnknown: false,
  })
  if (!normalized) return null

  const data = isRecord(normalized.data) ? normalized.data : null
  if (data) {
    const provider = typeof data.provider === 'string' ? data.provider.trim() : ''
    const providerParams = sanitizeMarketProviderParamsForWidget(provider, data.providerParams)
    const auth = sanitizeMarketProviderAuth(data.auth)
    const nextData = Object.entries(data).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (key !== 'provider' && key !== 'providerParams' && key !== 'auth') {
        acc[key] = value
      }
      return acc
    }, {})

    if (provider) nextData.provider = provider
    if (providerParams) nextData.providerParams = providerParams
    if (auth) nextData.auth = auth
    normalized.data = Object.keys(nextData).length > 0 ? nextData : undefined
  }

  const nextParams = Object.entries(normalized).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      if (value !== undefined) acc[key] = value
      return acc
    },
    {}
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

  const currentView = isRecord(currentParams?.view) ? currentParams.view : null
  const incomingView = isRecord(incomingParams.view) ? incomingParams.view : null
  if (incomingView) {
    const nextView = currentView ? { ...currentView, ...incomingView } : { ...incomingView }
    if ('drawTools' in nextView) {
      nextView.drawTools = mergeDrawToolsSnapshots(currentView?.drawTools, nextView.drawTools)
    }
    merged.view = nextView
  }

  const currentData = isRecord(currentParams?.data) ? currentParams.data : null
  const incomingData = isRecord(incomingParams.data) ? incomingParams.data : null
  if (incomingData) {
    merged.data = currentData ? { ...currentData, ...incomingData } : { ...incomingData }
  }

  const currentRuntime = isRecord(currentParams?.runtime) ? currentParams.runtime : null
  const incomingRuntime = isRecord(incomingParams.runtime) ? incomingParams.runtime : null
  if (incomingRuntime) {
    merged.runtime = currentRuntime
      ? { ...currentRuntime, ...incomingRuntime }
      : { ...incomingRuntime }
  }

  return sanitizeDataChartParams(merged, { strictUnknown: true })
}

const collectIndicatorReference = (
  value: unknown,
  path: string
): WidgetReferenceParamCandidate | null => {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id ? { field: 'indicatorId', value: id, path } : null
}

const collectDataChartReferenceParams = (
  params: Record<string, unknown> | null
): WidgetReferenceParamCandidate[] => {
  const view = isRecord(params?.view) ? params.view : null
  if (!view) return []

  const references: WidgetReferenceParamCandidate[] = []
  if (Array.isArray(view.pineIndicators)) {
    view.pineIndicators.forEach((entry, index) => {
      if (!isRecord(entry)) return
      const reference = collectIndicatorReference(entry.id, `view.pineIndicators[${index}].id`)
      if (reference) references.push(reference)
    })
  }

  if (Array.isArray(view.drawTools)) {
    view.drawTools.forEach((entry, index) => {
      if (!isRecord(entry)) return
      const reference = collectIndicatorReference(
        entry.indicatorId,
        `view.drawTools[${index}].indicatorId`
      )
      if (reference) references.push(reference)
    })
  }

  return references
}

export const dataChartWidgetContract = defineWidgetContract({
  key: 'data_chart',
  title: 'Chart',
  category: 'trading',
  description: 'Market chart for a selected listing.',
  editable: true,
  editableFields: [...DATA_CHART_FIELDS],
  paramContract: DATA_CHART_PARAM_CONTRACT,
  linkedParamFields: ['listing'],
  defaultParams: null,
  sanitizeLocalParams: sanitizeDataChartParams,
  mergeLocalParams: mergeDataChartParams,
  collectAdditionalReferenceParams: collectDataChartReferenceParams,
  examples: [
    {
      widgetKey: 'data_chart',
      params: { listing: { listing_type: 'default' } },
    },
  ],
  bestPractices: [
    'Set listing with edit_widget; keep provider credentials under data and indicators under view.pineIndicators.',
  ],
  validationHints: [
    'Unknown top-level params are rejected.',
    'Use view.pineIndicators[].id with ids returned by list_indicators.',
  ],
})
