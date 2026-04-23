import type { IndicatorMonitorRecord } from './types'

export const MONITOR_LAYOUTS = ['board', 'roadmap'] as const
export const MONITOR_TIMELINE_RANGES = ['daily', 'monthly', 'quarterly'] as const
export const MONITOR_GROUP_BY_OPTIONS = [
  'status',
  'workflow',
  'trigger',
  'listing',
  'assetType',
  'provider',
  'interval',
] as const
export const MONITOR_SORT_FIELDS = [
  'updatedAt',
  'listingLabel',
  'workflowName',
  'providerId',
  'interval',
] as const
export const MONITOR_SORT_DIRECTIONS = ['asc', 'desc'] as const

export type MonitorLayout = (typeof MONITOR_LAYOUTS)[number]
export type MonitorTimelineRange = (typeof MONITOR_TIMELINE_RANGES)[number]
export type MonitorGroupBy = (typeof MONITOR_GROUP_BY_OPTIONS)[number]
export type MonitorSortField = (typeof MONITOR_SORT_FIELDS)[number]
export type MonitorSortDirection = (typeof MONITOR_SORT_DIRECTIONS)[number]

export const MIN_MONITOR_TIMELINE_ZOOM = 50
export const MAX_MONITOR_TIMELINE_ZOOM = 200
export const DEFAULT_MONITOR_TIMELINE_ZOOM = 100
export const MONITOR_TIMELINE_ZOOM_STEP = 25

export type MonitorViewFilters = {
  workflowId: string | null
  attentionOnly: boolean
  triggerIds: string[]
  providerIds: string[]
  intervals: string[]
  assetTypes: string[]
}

export type MonitorVisibleFields = {
  workflow: boolean
  provider: boolean
  interval: boolean
  assetType: boolean
  trigger: boolean
  authHealth: boolean
  deployHealth: boolean
  updatedAt: boolean
}

export type MonitorPanelSizes = {
  board: [number, number] | null
  roadmap: [number, number] | null
}

export type MonitorViewConfig = {
  layout: MonitorLayout
  board: {
    groupBy: MonitorGroupBy
    cardOrder: string[]
  }
  roadmap: {
    range: MonitorTimelineRange
    zoom: number
  }
  sort: {
    field: MonitorSortField
    direction: MonitorSortDirection
  }
  filters: MonitorViewFilters
  visibleFields: MonitorVisibleFields
  panelSizes: MonitorPanelSizes
}

export type MonitorWorkingState = {
  layout: MonitorLayout
  filters: Pick<MonitorViewFilters, 'workflowId' | 'attentionOnly'>
  panelSizes: MonitorPanelSizes
}

export type MonitorViewRow = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  config: MonitorViewConfig
  createdAt: string
  updatedAt: string
}

export type MonitorViewRowResponse = MonitorViewRow

export type MonitorViewsListResponse = {
  data: MonitorViewRowResponse[]
}

export type CreateMonitorViewBody = {
  name: string
  config: MonitorViewConfig
  makeActive?: boolean
}

export type UpdateMonitorViewBody = {
  name?: string
  config?: MonitorViewConfig
}

export type MonitorTriggerId = IndicatorMonitorRecord['providerConfig']['triggerId'] | string

export const DEFAULT_MONITOR_VIEW_CONFIG: MonitorViewConfig = {
  layout: 'board',
  board: {
    groupBy: 'status',
    cardOrder: [],
  },
  roadmap: {
    range: 'monthly',
    zoom: DEFAULT_MONITOR_TIMELINE_ZOOM,
  },
  sort: {
    field: 'updatedAt',
    direction: 'desc',
  },
  filters: {
    workflowId: null,
    attentionOnly: false,
    triggerIds: [],
    providerIds: [],
    intervals: [],
    assetTypes: [],
  },
  visibleFields: {
    workflow: true,
    provider: true,
    interval: true,
    assetType: false,
    trigger: false,
    authHealth: true,
    deployHealth: true,
    updatedAt: true,
  },
  panelSizes: {
    board: null,
    roadmap: null,
  },
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const uniqueStrings = (value: unknown) => {
  if (!Array.isArray(value)) return []
  const unique = new Set<string>()

  value.forEach((entry) => {
    if (typeof entry !== 'string') return
    const trimmed = entry.trim()
    if (!trimmed) return
    unique.add(trimmed)
  })

  return Array.from(unique)
}

const uniqueNormalizedStrings = (value: unknown, normalize: (value: string) => string) => {
  if (!Array.isArray(value)) return []
  const unique = new Set<string>()

  value.forEach((entry) => {
    if (typeof entry !== 'string') return
    const trimmed = entry.trim()
    if (!trimmed) return
    unique.add(normalize(trimmed))
  })

  return Array.from(unique)
}

const normalizePanelSizesValue = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null

  const tuple = value.map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
  if (tuple.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    return null
  }

  const total = tuple[0]! + tuple[1]!
  if (Math.abs(total - 100) > 1) {
    return null
  }

  return [tuple[0]!, tuple[1]!]
}

const normalizeLayout = (value: unknown): MonitorLayout =>
  typeof value === 'string' && MONITOR_LAYOUTS.includes(value as MonitorLayout)
    ? (value as MonitorLayout)
    : DEFAULT_MONITOR_VIEW_CONFIG.layout

const normalizeTimelineRange = (value: unknown): MonitorTimelineRange =>
  typeof value === 'string' && MONITOR_TIMELINE_RANGES.includes(value as MonitorTimelineRange)
    ? (value as MonitorTimelineRange)
    : DEFAULT_MONITOR_VIEW_CONFIG.roadmap.range

const normalizeTimelineZoom = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MONITOR_VIEW_CONFIG.roadmap.zoom
  }

  return Math.min(MAX_MONITOR_TIMELINE_ZOOM, Math.max(MIN_MONITOR_TIMELINE_ZOOM, Math.round(parsed)))
}

const normalizeGroupBy = (value: unknown): MonitorGroupBy =>
  typeof value === 'string' && MONITOR_GROUP_BY_OPTIONS.includes(value as MonitorGroupBy)
    ? (value as MonitorGroupBy)
    : DEFAULT_MONITOR_VIEW_CONFIG.board.groupBy

const normalizeSortField = (value: unknown): MonitorSortField =>
  typeof value === 'string' && MONITOR_SORT_FIELDS.includes(value as MonitorSortField)
    ? (value as MonitorSortField)
    : DEFAULT_MONITOR_VIEW_CONFIG.sort.field

const normalizeSortDirection = (value: unknown): MonitorSortDirection =>
  typeof value === 'string' && MONITOR_SORT_DIRECTIONS.includes(value as MonitorSortDirection)
    ? (value as MonitorSortDirection)
    : DEFAULT_MONITOR_VIEW_CONFIG.sort.direction

export const normalizeMonitorViewConfig = (value: unknown): MonitorViewConfig => {
  const record = isObject(value) ? value : {}
  const board = isObject(record.board) ? record.board : {}
  const roadmap = isObject(record.roadmap) ? record.roadmap : {}
  const sort = isObject(record.sort) ? record.sort : {}
  const filters = isObject(record.filters) ? record.filters : {}
  const visibleFields = isObject(record.visibleFields) ? record.visibleFields : {}
  const panelSizes = isObject(record.panelSizes) ? record.panelSizes : {}

  return {
    layout: normalizeLayout(record.layout),
    board: {
      groupBy: normalizeGroupBy(board.groupBy),
      cardOrder: uniqueStrings(board.cardOrder),
    },
    roadmap: {
      range: normalizeTimelineRange(roadmap.range),
      zoom: normalizeTimelineZoom(roadmap.zoom),
    },
    sort: {
      field: normalizeSortField(sort.field),
      direction: normalizeSortDirection(sort.direction),
    },
    filters: {
      workflowId:
        typeof filters.workflowId === 'string' && filters.workflowId.trim().length > 0
          ? filters.workflowId.trim()
          : null,
      attentionOnly:
        typeof filters.attentionOnly === 'boolean'
          ? filters.attentionOnly
          : DEFAULT_MONITOR_VIEW_CONFIG.filters.attentionOnly,
      triggerIds: uniqueStrings(filters.triggerIds),
      providerIds: uniqueStrings(filters.providerIds),
      intervals: uniqueStrings(filters.intervals),
      assetTypes: uniqueNormalizedStrings(filters.assetTypes, (entry) => entry.toLowerCase()),
    },
    visibleFields: {
      workflow:
        typeof visibleFields.workflow === 'boolean'
          ? visibleFields.workflow
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.workflow,
      provider:
        typeof visibleFields.provider === 'boolean'
          ? visibleFields.provider
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.provider,
      interval:
        typeof visibleFields.interval === 'boolean'
          ? visibleFields.interval
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.interval,
      assetType:
        typeof visibleFields.assetType === 'boolean'
          ? visibleFields.assetType
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.assetType,
      trigger:
        typeof visibleFields.trigger === 'boolean'
          ? visibleFields.trigger
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.trigger,
      authHealth:
        typeof visibleFields.authHealth === 'boolean'
          ? visibleFields.authHealth
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.authHealth,
      deployHealth:
        typeof visibleFields.deployHealth === 'boolean'
          ? visibleFields.deployHealth
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.deployHealth,
      updatedAt:
        typeof visibleFields.updatedAt === 'boolean'
          ? visibleFields.updatedAt
          : DEFAULT_MONITOR_VIEW_CONFIG.visibleFields.updatedAt,
    },
    panelSizes: {
      board:
        normalizePanelSizesValue(panelSizes.board) ?? DEFAULT_MONITOR_VIEW_CONFIG.panelSizes.board,
      roadmap:
        normalizePanelSizesValue(panelSizes.roadmap) ??
        DEFAULT_MONITOR_VIEW_CONFIG.panelSizes.roadmap,
    },
  }
}

export const normalizeMonitorConfigForDataset = (
  config: MonitorViewConfig,
  options: { hasMultipleTriggers: boolean }
) => {
  if (options.hasMultipleTriggers) return config

  return {
    ...config,
    board: {
      ...config.board,
      groupBy: config.board.groupBy === 'trigger' ? 'status' : config.board.groupBy,
    },
    filters: {
      ...config.filters,
      triggerIds: [],
    },
    visibleFields: {
      ...config.visibleFields,
      trigger: false,
    },
  } satisfies MonitorViewConfig
}

export const resolveMonitorRuntimeConfig = (
  value: unknown,
  options: { datasetReady: boolean; hasMultipleTriggers: boolean }
): MonitorViewConfig => {
  const normalizedConfig = normalizeMonitorViewConfig(value)

  if (!options.datasetReady) {
    return normalizedConfig
  }

  return normalizeMonitorConfigForDataset(normalizedConfig, {
    hasMultipleTriggers: options.hasMultipleTriggers,
  })
}

export const getMonitorWorkingStateFromConfig = (
  config: MonitorViewConfig
): MonitorWorkingState => ({
  layout: config.layout,
  filters: {
    workflowId: config.filters.workflowId,
    attentionOnly: config.filters.attentionOnly,
  },
  panelSizes: config.panelSizes,
})

export const applyMonitorWorkingState = (
  baseConfig: MonitorViewConfig,
  workingState: unknown
): MonitorViewConfig => {
  const config = normalizeMonitorViewConfig(baseConfig)
  const record = isObject(workingState) ? workingState : {}
  const filters = isObject(record.filters) ? record.filters : {}
  const panelSizes = isObject(record.panelSizes) ? record.panelSizes : {}

  return {
    ...config,
    layout: normalizeLayout(record.layout),
    filters: {
      ...config.filters,
      workflowId:
        typeof filters.workflowId === 'string' && filters.workflowId.trim().length > 0
          ? filters.workflowId.trim()
          : null,
      attentionOnly:
        typeof filters.attentionOnly === 'boolean'
          ? filters.attentionOnly
          : config.filters.attentionOnly,
    },
    panelSizes: {
      board: normalizePanelSizesValue(panelSizes.board),
      roadmap: normalizePanelSizesValue(panelSizes.roadmap),
    },
  }
}
