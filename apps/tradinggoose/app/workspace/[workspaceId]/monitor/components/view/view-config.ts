import { toListingValueObject } from '@/lib/listing/identity'
import { normalizeConfigFilterValues } from '../config/config-filter-values'

export const MONITOR_PAGE_MODES = ['executions', 'config'] as const
export type MonitorPageMode = (typeof MONITOR_PAGE_MODES)[number]

const EXECUTION_MONITOR_LAYOUTS = ['kanban', 'timeline'] as const
export const EXECUTION_MONITOR_GROUP_FIELDS = [
  'outcome',
  'workflow',
  'trigger',
  'listing',
  'assetType',
  'provider',
  'interval',
  'monitor',
] as const
export const EXECUTION_MONITOR_SORT_FIELDS = [
  'startedAt',
  'endedAt',
  'durationMs',
  'cost',
  'workflowName',
  'providerId',
  'interval',
  'listingLabel',
] as const
const EXECUTION_MONITOR_SORT_DIRECTIONS = ['asc', 'desc'] as const
export const EXECUTION_MONITOR_FIELD_SUMS = ['count', 'durationMs', 'cost'] as const
export const EXECUTION_MONITOR_TIMELINE_ZOOM = ['day', 'week', 'month'] as const
export const MONITOR_TIMELINE_SCALE_MIN = 60
export const MONITOR_TIMELINE_SCALE_MAX = 180
export const MONITOR_TIMELINE_SCALE_STEP = 20
export const DEFAULT_MONITOR_TIMEZONE = 'UTC'
export const EXECUTION_MONITOR_VISIBLE_FIELDS = [
  'workflow',
  'provider',
  'interval',
  'assetType',
  'trigger',
  'startedAt',
  'endedAt',
  'durationMs',
  'cost',
  'monitor',
] as const
const EXECUTION_MONITOR_QUICK_FILTER_FIELDS = [
  'outcome',
  'workflow',
  'trigger',
  'listing',
  'assetType',
  'provider',
  'interval',
  'monitor',
] as const
const EXECUTION_MONITOR_QUICK_FILTER_OPERATORS = ['include', 'exclude', 'has', 'no'] as const

export const CONFIG_MONITOR_DIMENSION_FIELDS = [
  'workflowTarget',
  'indicator',
  'listing',
  'provider',
  'interval',
] as const
const CONFIG_MONITOR_STATUS = ['active', 'paused'] as const
const CONFIG_MONITOR_FILTER_FIELDS = [
  ...CONFIG_MONITOR_DIMENSION_FIELDS,
  'status',
  'lastExecutionAt',
  'lastOutcome',
  'lastExecutionLogId',
] as const
const CONFIG_MONITOR_FILTER_OPERATORS = ['=', '!=', 'has', 'no'] as const
export const CONFIG_MONITOR_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'workflowTargetLabel',
  'indicatorName',
  'listingLabel',
  'providerId',
  'interval',
  'status',
  'lastExecutionAt',
  'lastOutcome',
] as const
const CONFIG_MONITOR_SORT_DIRECTIONS = ['asc', 'desc'] as const
export const CONFIG_MONITOR_VISIBLE_FIELDS = [
  'workflowTarget',
  'indicator',
  'listing',
  'provider',
  'interval',
  'status',
  'createdAt',
  'updatedAt',
  'lastExecutionAt',
  'lastOutcome',
] as const
export const CONFIG_MONITOR_FIELD_SUMS = ['count', 'activeCount', 'pausedCount'] as const

type ExecutionMonitorLayout = (typeof EXECUTION_MONITOR_LAYOUTS)[number]
export type ExecutionMonitorGroupField = (typeof EXECUTION_MONITOR_GROUP_FIELDS)[number]
export type ExecutionMonitorSortField = (typeof EXECUTION_MONITOR_SORT_FIELDS)[number]
type ExecutionMonitorSortDirection = (typeof EXECUTION_MONITOR_SORT_DIRECTIONS)[number]
export type ExecutionMonitorFieldSum = (typeof EXECUTION_MONITOR_FIELD_SUMS)[number]
export type ExecutionMonitorTimelineZoom = (typeof EXECUTION_MONITOR_TIMELINE_ZOOM)[number]
export type ExecutionMonitorVisibleFieldId = (typeof EXECUTION_MONITOR_VISIBLE_FIELDS)[number]
export type ExecutionMonitorQuickFilterField =
  (typeof EXECUTION_MONITOR_QUICK_FILTER_FIELDS)[number]
type ExecutionMonitorQuickFilterOperator = (typeof EXECUTION_MONITOR_QUICK_FILTER_OPERATORS)[number]

export type ExecutionMonitorQuickFilter = {
  field: ExecutionMonitorQuickFilterField
  operator: ExecutionMonitorQuickFilterOperator
  values: string[]
}

export type ExecutionMonitorSortRule = {
  field: ExecutionMonitorSortField
  direction: ExecutionMonitorSortDirection
}

export type ExecutionMonitorViewConfig = {
  mode: 'executions'
  layout: ExecutionMonitorLayout
  filterQuery: string
  quickFilters: ExecutionMonitorQuickFilter[]
  sortBy: ExecutionMonitorSortRule[]
  groupBy: ExecutionMonitorGroupField
  verticalGroupBy: ExecutionMonitorGroupField | null
  sliceBy: ExecutionMonitorGroupField | null
  fieldSums: ExecutionMonitorFieldSum[]
  timezone: string
  kanban: {
    columnField: ExecutionMonitorGroupField
    hiddenColumnIds: string[]
    columnLimits: Record<string, number>
    localCardOrder: Record<string, string[]>
    visibleFieldIds: ExecutionMonitorVisibleFieldId[]
  }
  timeline: {
    dateFields: {
      start: 'startedAt'
      end: 'endedAt'
    }
    markers: {
      today: boolean
      intervalBoundaries: boolean
    }
    zoom: ExecutionMonitorTimelineZoom
    scale: number
  }
}

export type ConfigMonitorDimensionField = (typeof CONFIG_MONITOR_DIMENSION_FIELDS)[number]
export type ConfigMonitorStatus = (typeof CONFIG_MONITOR_STATUS)[number]
export type ConfigMonitorFilterField = (typeof CONFIG_MONITOR_FILTER_FIELDS)[number]
export type ConfigMonitorFilterOperator = (typeof CONFIG_MONITOR_FILTER_OPERATORS)[number]
export type ConfigMonitorFilter = {
  field: ConfigMonitorFilterField
  operator: ConfigMonitorFilterOperator
  values: string[]
}
export type ConfigMonitorSortField = (typeof CONFIG_MONITOR_SORT_FIELDS)[number]
type ConfigMonitorSortDirection = (typeof CONFIG_MONITOR_SORT_DIRECTIONS)[number]
export type ConfigMonitorSortRule = {
  field: ConfigMonitorSortField
  direction: ConfigMonitorSortDirection
}
export type ConfigMonitorVisibleField = (typeof CONFIG_MONITOR_VISIBLE_FIELDS)[number]
export type ConfigMonitorFieldSum = (typeof CONFIG_MONITOR_FIELD_SUMS)[number]

export type ConfigMonitorViewConfig = {
  mode: 'config'
  filterQuery: string
  quickFilters: ConfigMonitorFilter[]
  sortBy: ConfigMonitorSortRule[]
  groupBy: ConfigMonitorDimensionField
  verticalGroupBy: ConfigMonitorDimensionField | null
  sliceBy: ConfigMonitorDimensionField | null
  fieldSums: ConfigMonitorFieldSum[]
  timezone: string
  kanban: {
    localCardOrder: Record<string, string[]>
    visibleFieldIds: ConfigMonitorVisibleField[]
  }
}

export type MonitorSavedViewConfig = ExecutionMonitorViewConfig | ConfigMonitorViewConfig

export type MonitorShellWorkingState = {
  activeMode: MonitorPageMode
  activeViewIdsByMode: Partial<Record<MonitorPageMode, string | null>>
  executionPanelSizes: [number, number] | null
  configPanelSizes: [number, number] | null
}

export type MonitorViewRow = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  mode: MonitorPageMode
  config: MonitorSavedViewConfig
  createdAt: string
  updatedAt: string
}

export type MonitorViewsListResponse = {
  data: MonitorViewRow[]
}

export type CreateMonitorViewBody = {
  name: string
  config: MonitorSavedViewConfig
  makeActive?: boolean
}

export type UpdateMonitorViewBody = {
  name?: string
  config?: MonitorSavedViewConfig
}

export class InvalidMonitorViewConfigRequestError extends Error {
  constructor(message = 'Invalid monitor view config.') {
    super(message)
    this.name = 'InvalidMonitorViewConfigRequestError'
  }
}

export class UnsupportedMonitorViewConfigError extends Error {
  constructor(
    message = 'Unsupported monitor view data. Delete or reset stale mode-less monitor_view rows for this workspace before using the mode-aware monitor page.'
  ) {
    super(message)
    this.name = 'UnsupportedMonitorViewConfigError'
  }
}

export const DEFAULT_EXECUTION_PANEL_SIZES = [68, 32] as [number, number]
export const DEFAULT_CONFIG_PANEL_SIZES = [68, 32] as [number, number]

export const DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG: ExecutionMonitorViewConfig = {
  mode: 'executions',
  layout: 'kanban',
  filterQuery: '',
  quickFilters: [],
  sortBy: [{ field: 'startedAt', direction: 'desc' }],
  groupBy: 'outcome',
  verticalGroupBy: null,
  sliceBy: null,
  fieldSums: ['count'],
  timezone: DEFAULT_MONITOR_TIMEZONE,
  kanban: {
    columnField: 'outcome',
    hiddenColumnIds: [],
    columnLimits: {},
    localCardOrder: {},
    visibleFieldIds: ['workflow', 'provider', 'interval', 'startedAt', 'durationMs'],
  },
  timeline: {
    dateFields: {
      start: 'startedAt',
      end: 'endedAt',
    },
    markers: {
      today: true,
      intervalBoundaries: true,
    },
    zoom: 'week',
    scale: 100,
  },
}

export const DEFAULT_CONFIG_MONITOR_VIEW_CONFIG: ConfigMonitorViewConfig = {
  mode: 'config',
  filterQuery: '',
  quickFilters: [],
  sortBy: [{ field: 'updatedAt', direction: 'desc' }],
  groupBy: 'workflowTarget',
  verticalGroupBy: null,
  sliceBy: null,
  fieldSums: ['count', 'activeCount', 'pausedCount'],
  timezone: DEFAULT_MONITOR_TIMEZONE,
  kanban: {
    localCardOrder: {},
    visibleFieldIds: [
      'indicator',
      'listing',
      'provider',
      'interval',
      'status',
      'updatedAt',
      'lastExecutionAt',
      'lastOutcome',
    ],
  },
}

export const DEFAULT_MONITOR_SHELL_WORKING_STATE: MonitorShellWorkingState = {
  activeMode: 'executions',
  activeViewIdsByMode: {},
  executionPanelSizes: null,
  configPanelSizes: null,
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

const uniqueValues = <T extends string>(value: unknown, allowed: readonly T[]) => {
  if (!Array.isArray(value)) return []
  const unique = new Set<T>()

  value.forEach((entry) => {
    if (typeof entry !== 'string') return
    if (allowed.includes(entry as T)) {
      unique.add(entry as T)
    }
  })

  return Array.from(unique)
}

const normalizeAllowedArray = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[]
) => {
  if (typeof value === 'undefined') {
    return fallback
  }

  if (!Array.isArray(value)) {
    return fallback
  }

  const normalized = uniqueValues(value, allowed)
  if (value.length > 0 && normalized.length === 0) {
    return fallback
  }

  return normalized
}

const normalizePanelSizes = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null

  const first = typeof value[0] === 'number' ? value[0] : Number.NaN
  const second = typeof value[1] === 'number' ? value[1] : Number.NaN

  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
    return null
  }

  if (Math.abs(first + second - 100) > 1) {
    return null
  }

  return [first, second]
}

const normalizeExecutionGroupField = (
  value: unknown,
  fallback: ExecutionMonitorGroupField
): ExecutionMonitorGroupField =>
  typeof value === 'string' &&
  EXECUTION_MONITOR_GROUP_FIELDS.includes(value as ExecutionMonitorGroupField)
    ? (value as ExecutionMonitorGroupField)
    : fallback

const normalizeNullableExecutionGroupField = (value: unknown): ExecutionMonitorGroupField | null =>
  typeof value === 'string' &&
  EXECUTION_MONITOR_GROUP_FIELDS.includes(value as ExecutionMonitorGroupField)
    ? (value as ExecutionMonitorGroupField)
    : null

const normalizeExecutionLayout = (value: unknown): ExecutionMonitorLayout =>
  typeof value === 'string' && EXECUTION_MONITOR_LAYOUTS.includes(value as ExecutionMonitorLayout)
    ? (value as ExecutionMonitorLayout)
    : DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.layout

const normalizeTimelineScale = (value: unknown) => {
  const rawValue = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.timeline.scale
  }

  const stepped = Math.round(rawValue / MONITOR_TIMELINE_SCALE_STEP) * MONITOR_TIMELINE_SCALE_STEP
  return Math.min(MONITOR_TIMELINE_SCALE_MAX, Math.max(MONITOR_TIMELINE_SCALE_MIN, stepped))
}

const normalizeTimezone = (value: unknown) => {
  if (typeof value !== 'string') {
    return DEFAULT_MONITOR_TIMEZONE
  }

  const trimmed = value.trim()
  return trimmed || DEFAULT_MONITOR_TIMEZONE
}

const normalizeExecutionSortBy = (value: unknown): ExecutionMonitorSortRule[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.sortBy
  }

  const seenFields = new Set<ExecutionMonitorSortField>()
  const normalized = value
    .map((entry) => {
      if (!isObject(entry)) return null
      const field =
        typeof entry.field === 'string' &&
        EXECUTION_MONITOR_SORT_FIELDS.includes(entry.field as ExecutionMonitorSortField)
          ? (entry.field as ExecutionMonitorSortField)
          : null
      const direction =
        typeof entry.direction === 'string' &&
        EXECUTION_MONITOR_SORT_DIRECTIONS.includes(entry.direction as ExecutionMonitorSortDirection)
          ? (entry.direction as ExecutionMonitorSortDirection)
          : null

      if (!field || !direction || seenFields.has(field)) {
        return null
      }

      seenFields.add(field)
      return { field, direction } satisfies ExecutionMonitorSortRule
    })
    .filter((entry): entry is ExecutionMonitorSortRule => Boolean(entry))
    .slice(0, 2)

  return normalized
}

const normalizeExecutionQuickFilters = (value: unknown): ExecutionMonitorQuickFilter[] => {
  if (!Array.isArray(value)) return []

  const normalizeQuickFilterValues = (
    field: ExecutionMonitorQuickFilterField,
    rawValue: unknown
  ) => {
    if (!Array.isArray(rawValue)) return []

    const normalized = new Set<string>()

    rawValue.forEach((entry) => {
      if (typeof entry !== 'string') return
      const trimmed = entry.trim()
      if (!trimmed) return

      switch (field) {
        case 'workflow':
        case 'monitor':
        case 'provider': {
          const normalizedId = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed
          if (normalizedId) {
            normalized.add(normalizedId)
          }
          return
        }
        case 'listing': {
          try {
            const normalizedListing = toListingValueObject(JSON.parse(trimmed))
            if (!normalizedListing) return
            normalized.add(JSON.stringify(normalizedListing))
          } catch {
            return
          }
          return
        }
        case 'assetType':
          normalized.add(trimmed.toLowerCase())
          return
        case 'outcome':
        case 'trigger':
        case 'interval':
          normalized.add(trimmed.toLowerCase())
          return
      }
    })

    return Array.from(normalized)
  }

  return value
    .map((entry) => {
      if (!isObject(entry)) return null
      const field =
        typeof entry.field === 'string' &&
        EXECUTION_MONITOR_QUICK_FILTER_FIELDS.includes(
          entry.field as ExecutionMonitorQuickFilterField
        )
          ? (entry.field as ExecutionMonitorQuickFilterField)
          : null
      const operator =
        typeof entry.operator === 'string' &&
        EXECUTION_MONITOR_QUICK_FILTER_OPERATORS.includes(
          entry.operator as ExecutionMonitorQuickFilterOperator
        )
          ? (entry.operator as ExecutionMonitorQuickFilterOperator)
          : null

      if (!field || !operator) return null

      const values = normalizeQuickFilterValues(field, entry.values)
      if ((operator === 'include' || operator === 'exclude') && values.length === 0) {
        return null
      }
      if ((operator === 'has' || operator === 'no') && values.length > 0) {
        return null
      }

      return {
        field,
        operator,
        values: operator === 'has' || operator === 'no' ? [] : values,
      } satisfies ExecutionMonitorQuickFilter
    })
    .filter((entry): entry is ExecutionMonitorQuickFilter => Boolean(entry))
}

const normalizeColumnLimits = (value: unknown) => {
  if (!isObject(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, rawValue]) => {
        const limit = typeof rawValue === 'number' ? rawValue : Number.NaN
        if (!key.trim() || !Number.isFinite(limit) || limit <= 0) {
          return null
        }
        return [key.trim(), Math.round(limit)] as const
      })
      .filter((entry): entry is readonly [string, number] => Boolean(entry))
  )
}

const normalizeLocalCardOrder = (value: unknown) => {
  if (!isObject(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(([columnId, rawValues]) => {
        const values = uniqueStrings(rawValues)
        if (!columnId.trim() || values.length === 0) {
          return null
        }
        return [columnId.trim(), values] as const
      })
      .filter((entry): entry is readonly [string, string[]] => Boolean(entry))
  )
}

const normalizeConfigDimensionField = (
  value: unknown,
  fallback: ConfigMonitorDimensionField
): ConfigMonitorDimensionField =>
  typeof value === 'string' &&
  CONFIG_MONITOR_DIMENSION_FIELDS.includes(value as ConfigMonitorDimensionField)
    ? (value as ConfigMonitorDimensionField)
    : fallback

const normalizeNullableConfigDimensionField = (
  value: unknown
): ConfigMonitorDimensionField | null =>
  typeof value === 'string' &&
  CONFIG_MONITOR_DIMENSION_FIELDS.includes(value as ConfigMonitorDimensionField)
    ? (value as ConfigMonitorDimensionField)
    : null

const normalizeDistinctAxes = <T extends string>(
  groupBy: T,
  sliceBy: T | null,
  verticalGroupBy: T | null
) => {
  const normalizedSliceBy = sliceBy === groupBy ? null : sliceBy

  return {
    sliceBy: normalizedSliceBy,
    verticalGroupBy:
      verticalGroupBy && verticalGroupBy !== groupBy && verticalGroupBy !== normalizedSliceBy
        ? verticalGroupBy
        : null,
  }
}

const normalizeConfigSortBy = (value: unknown): ConfigMonitorSortRule[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CONFIG_MONITOR_VIEW_CONFIG.sortBy
  }

  const seenFields = new Set<ConfigMonitorSortField>()
  const normalized = value
    .map((entry) => {
      if (!isObject(entry)) return null
      const field =
        typeof entry.field === 'string' &&
        CONFIG_MONITOR_SORT_FIELDS.includes(entry.field as ConfigMonitorSortField)
          ? (entry.field as ConfigMonitorSortField)
          : null
      const direction =
        typeof entry.direction === 'string' &&
        CONFIG_MONITOR_SORT_DIRECTIONS.includes(entry.direction as ConfigMonitorSortDirection)
          ? (entry.direction as ConfigMonitorSortDirection)
          : null

      if (!field || !direction || seenFields.has(field)) {
        return null
      }

      seenFields.add(field)
      return { field, direction } satisfies ConfigMonitorSortRule
    })
    .filter((entry): entry is ConfigMonitorSortRule => Boolean(entry))
    .slice(0, 2)

  return normalized
}

const normalizeConfigQuickFilters = (value: unknown): ConfigMonitorFilter[] => {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!isObject(entry)) return null
      const field =
        typeof entry.field === 'string' &&
        CONFIG_MONITOR_FILTER_FIELDS.includes(entry.field as ConfigMonitorFilterField)
          ? (entry.field as ConfigMonitorFilterField)
          : null
      const operator =
        typeof entry.operator === 'string' &&
        CONFIG_MONITOR_FILTER_OPERATORS.includes(entry.operator as ConfigMonitorFilterOperator)
          ? (entry.operator as ConfigMonitorFilterOperator)
          : null
      if (!field || !operator) return null

      const isPresenceField =
        field === 'lastExecutionAt' || field === 'lastOutcome' || field === 'lastExecutionLogId'
      if ((operator === 'has' || operator === 'no') && !isPresenceField) {
        return null
      }
      if (
        (operator === '=' || operator === '!=') &&
        (field === 'lastExecutionAt' || field === 'lastExecutionLogId')
      ) {
        return null
      }

      const values =
        operator === 'has' || operator === 'no'
          ? []
          : normalizeConfigFilterValues(field, entry.values)
      if ((operator === '=' || operator === '!=') && values.length === 0) {
        return null
      }

      return { field, operator, values } satisfies ConfigMonitorFilter
    })
    .filter((entry): entry is ConfigMonitorFilter => Boolean(entry))
}

export const normalizeExecutionMonitorViewConfig = (value: unknown): ExecutionMonitorViewConfig => {
  const record = isObject(value) ? value : {}
  const kanban = isObject(record.kanban) ? record.kanban : {}
  const timeline = isObject(record.timeline) ? record.timeline : {}
  const timelineDateFields = isObject(timeline.dateFields) ? timeline.dateFields : {}
  const timelineMarkers = isObject(timeline.markers) ? timeline.markers : {}
  const groupBy = normalizeExecutionGroupField(
    record.groupBy,
    DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.groupBy
  )
  const axes = normalizeDistinctAxes(
    groupBy,
    normalizeNullableExecutionGroupField(record.sliceBy),
    normalizeNullableExecutionGroupField(record.verticalGroupBy)
  )

  return {
    mode: 'executions',
    layout: normalizeExecutionLayout(record.layout),
    filterQuery: typeof record.filterQuery === 'string' ? record.filterQuery.trim() : '',
    quickFilters: normalizeExecutionQuickFilters(record.quickFilters),
    sortBy: normalizeExecutionSortBy(record.sortBy),
    groupBy,
    verticalGroupBy: axes.verticalGroupBy,
    sliceBy: axes.sliceBy,
    fieldSums: normalizeAllowedArray(
      record.fieldSums,
      EXECUTION_MONITOR_FIELD_SUMS,
      DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.fieldSums
    ),
    timezone: normalizeTimezone(record.timezone),
    kanban: {
      columnField: normalizeExecutionGroupField(
        kanban.columnField,
        DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban.columnField
      ),
      hiddenColumnIds: uniqueStrings(kanban.hiddenColumnIds),
      columnLimits: normalizeColumnLimits(kanban.columnLimits),
      localCardOrder: normalizeLocalCardOrder(kanban.localCardOrder),
      visibleFieldIds: normalizeAllowedArray(
        kanban.visibleFieldIds,
        EXECUTION_MONITOR_VISIBLE_FIELDS,
        DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban.visibleFieldIds
      ),
    },
    timeline: {
      dateFields: {
        start: timelineDateFields.start === 'startedAt' ? 'startedAt' : 'startedAt',
        end: 'endedAt',
      },
      markers: {
        today:
          typeof timelineMarkers.today === 'boolean'
            ? timelineMarkers.today
            : DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.timeline.markers.today,
        intervalBoundaries:
          typeof timelineMarkers.intervalBoundaries === 'boolean'
            ? timelineMarkers.intervalBoundaries
            : DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.timeline.markers.intervalBoundaries,
      },
      zoom:
        typeof timeline.zoom === 'string' &&
        EXECUTION_MONITOR_TIMELINE_ZOOM.includes(timeline.zoom as ExecutionMonitorTimelineZoom)
          ? (timeline.zoom as ExecutionMonitorTimelineZoom)
          : DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.timeline.zoom,
      scale: normalizeTimelineScale(timeline.scale),
    },
  }
}

export const normalizeConfigMonitorViewConfig = (value: unknown): ConfigMonitorViewConfig => {
  const record = isObject(value) ? value : {}
  const kanban = isObject(record.kanban) ? record.kanban : {}

  const groupBy = normalizeConfigDimensionField(
    record.groupBy,
    DEFAULT_CONFIG_MONITOR_VIEW_CONFIG.groupBy
  )
  const axes = normalizeDistinctAxes(
    groupBy,
    normalizeNullableConfigDimensionField(record.sliceBy),
    normalizeNullableConfigDimensionField(record.verticalGroupBy)
  )

  return {
    mode: 'config',
    filterQuery: typeof record.filterQuery === 'string' ? record.filterQuery.trim() : '',
    quickFilters: normalizeConfigQuickFilters(record.quickFilters),
    sortBy: normalizeConfigSortBy(record.sortBy),
    groupBy,
    verticalGroupBy: axes.verticalGroupBy,
    sliceBy: axes.sliceBy,
    fieldSums: normalizeAllowedArray(
      record.fieldSums,
      CONFIG_MONITOR_FIELD_SUMS,
      DEFAULT_CONFIG_MONITOR_VIEW_CONFIG.fieldSums
    ),
    timezone: normalizeTimezone(record.timezone),
    kanban: {
      localCardOrder: normalizeLocalCardOrder(kanban.localCardOrder),
      visibleFieldIds: normalizeAllowedArray(
        kanban.visibleFieldIds,
        CONFIG_MONITOR_VISIBLE_FIELDS,
        DEFAULT_CONFIG_MONITOR_VIEW_CONFIG.kanban.visibleFieldIds
      ),
    },
  }
}

export const normalizeMonitorSavedViewConfig = (value: unknown): MonitorSavedViewConfig | null => {
  if (!isObject(value)) return null
  if (value.mode === 'executions') {
    return normalizeExecutionMonitorViewConfig(value)
  }
  if (value.mode === 'config') {
    return normalizeConfigMonitorViewConfig(value)
  }
  return null
}

const isAllowedString = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && allowed.includes(value as T)

const hasUniqueAllowedStrings = <T extends string>(value: unknown, allowed: readonly T[]) => {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  return value.every((entry) => {
    if (!isAllowedString(entry, allowed) || seen.has(entry)) return false
    seen.add(entry)
    return true
  })
}

const hasUniqueNonEmptyStrings = (value: unknown): value is string[] => {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  return value.every((entry) => {
    if (typeof entry !== 'string') return false
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) return false
    seen.add(trimmed)
    return true
  })
}

const hasValidLocalCardOrder = (value: unknown) =>
  isObject(value) &&
  Object.entries(value).every(
    ([key, entries]) => key.trim().length > 0 && hasUniqueNonEmptyStrings(entries)
  )

const hasValidColumnLimits = (value: unknown) =>
  isObject(value) &&
  Object.entries(value).every(
    ([key, limit]) =>
      key.trim().length > 0 && typeof limit === 'number' && Number.isFinite(limit) && limit > 0
  )

const hasValidExecutionSortBy = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 2) return false
  const seen = new Set<string>()
  return value.every((entry) => {
    if (!isObject(entry)) return false
    const field = entry.field
    const direction = entry.direction
    if (
      !isAllowedString(field, EXECUTION_MONITOR_SORT_FIELDS) ||
      !isAllowedString(direction, EXECUTION_MONITOR_SORT_DIRECTIONS) ||
      seen.has(field)
    ) {
      return false
    }
    seen.add(field)
    return true
  })
}

const hasValidConfigSortBy = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 2) return false
  const seen = new Set<string>()
  return value.every((entry) => {
    if (!isObject(entry)) return false
    const field = entry.field
    const direction = entry.direction
    if (
      !isAllowedString(field, CONFIG_MONITOR_SORT_FIELDS) ||
      !isAllowedString(direction, CONFIG_MONITOR_SORT_DIRECTIONS) ||
      seen.has(field)
    ) {
      return false
    }
    seen.add(field)
    return true
  })
}

const hasValidExecutionQuickFilters = (value: unknown) => {
  if (!Array.isArray(value)) return false
  return value.every((entry) => {
    if (!isObject(entry)) return false
    if (
      !isAllowedString(entry.field, EXECUTION_MONITOR_QUICK_FILTER_FIELDS) ||
      !isAllowedString(entry.operator, EXECUTION_MONITOR_QUICK_FILTER_OPERATORS)
    ) {
      return false
    }
    const values = entry.values
    if (entry.operator === 'has' || entry.operator === 'no') {
      return Array.isArray(values) && values.length === 0
    }
    return hasUniqueNonEmptyStrings(values) && normalizeExecutionQuickFilters([entry]).length === 1
  })
}

const hasValidConfigQuickFilters = (value: unknown) => {
  if (!Array.isArray(value)) return false
  return value.every((entry) => {
    if (!isObject(entry)) return false
    if (
      !isAllowedString(entry.field, CONFIG_MONITOR_FILTER_FIELDS) ||
      !isAllowedString(entry.operator, CONFIG_MONITOR_FILTER_OPERATORS)
    ) {
      return false
    }
    const isPresenceField =
      entry.field === 'lastExecutionAt' ||
      entry.field === 'lastOutcome' ||
      entry.field === 'lastExecutionLogId'
    if (entry.operator === 'has' || entry.operator === 'no') {
      return isPresenceField && Array.isArray(entry.values) && entry.values.length === 0
    }
    if (entry.field === 'lastExecutionAt' || entry.field === 'lastExecutionLogId') {
      return false
    }
    const values = entry.values
    if (!hasUniqueNonEmptyStrings(values)) return false
    const stringValues = values as string[]
    return (
      normalizeConfigFilterValues(entry.field as ConfigMonitorFilterField, stringValues).length ===
      stringValues.length
    )
  })
}

const hasValidTimezone = (value: unknown) => typeof value === 'string' && value.trim().length > 0

const hasDistinctAxes = (groupBy: unknown, sliceBy: unknown, verticalGroupBy: unknown) =>
  sliceBy !== groupBy &&
  verticalGroupBy !== groupBy &&
  (sliceBy === null || verticalGroupBy === null || sliceBy !== verticalGroupBy)

const hasValidExecutionShape = (record: Record<string, unknown>) => {
  const kanban = record.kanban
  const timeline = record.timeline
  if (!isObject(kanban) || !isObject(timeline)) return false
  const dateFields = timeline.dateFields
  const markers = timeline.markers
  return (
    record.mode === 'executions' &&
    isAllowedString(record.layout, EXECUTION_MONITOR_LAYOUTS) &&
    typeof record.filterQuery === 'string' &&
    hasValidExecutionQuickFilters(record.quickFilters) &&
    hasValidExecutionSortBy(record.sortBy) &&
    isAllowedString(record.groupBy, EXECUTION_MONITOR_GROUP_FIELDS) &&
    (record.verticalGroupBy === null ||
      isAllowedString(record.verticalGroupBy, EXECUTION_MONITOR_GROUP_FIELDS)) &&
    (record.sliceBy === null || isAllowedString(record.sliceBy, EXECUTION_MONITOR_GROUP_FIELDS)) &&
    hasDistinctAxes(record.groupBy, record.sliceBy, record.verticalGroupBy) &&
    hasUniqueAllowedStrings(record.fieldSums, EXECUTION_MONITOR_FIELD_SUMS) &&
    hasValidTimezone(record.timezone) &&
    isAllowedString(kanban.columnField, EXECUTION_MONITOR_GROUP_FIELDS) &&
    hasUniqueNonEmptyStrings(kanban.hiddenColumnIds) &&
    hasValidColumnLimits(kanban.columnLimits) &&
    hasValidLocalCardOrder(kanban.localCardOrder) &&
    hasUniqueAllowedStrings(kanban.visibleFieldIds, EXECUTION_MONITOR_VISIBLE_FIELDS) &&
    isObject(dateFields) &&
    dateFields.start === 'startedAt' &&
    dateFields.end === 'endedAt' &&
    isObject(markers) &&
    typeof markers.today === 'boolean' &&
    typeof markers.intervalBoundaries === 'boolean' &&
    isAllowedString(timeline.zoom, EXECUTION_MONITOR_TIMELINE_ZOOM) &&
    typeof timeline.scale === 'number' &&
    Number.isFinite(timeline.scale) &&
    timeline.scale >= MONITOR_TIMELINE_SCALE_MIN &&
    timeline.scale <= MONITOR_TIMELINE_SCALE_MAX &&
    timeline.scale % MONITOR_TIMELINE_SCALE_STEP === 0
  )
}

const hasValidConfigShape = (record: Record<string, unknown>) => {
  const kanban = record.kanban
  if (!isObject(kanban)) return false
  return (
    record.mode === 'config' &&
    typeof record.filterQuery === 'string' &&
    hasValidConfigQuickFilters(record.quickFilters) &&
    hasValidConfigSortBy(record.sortBy) &&
    isAllowedString(record.groupBy, CONFIG_MONITOR_DIMENSION_FIELDS) &&
    (record.verticalGroupBy === null ||
      isAllowedString(record.verticalGroupBy, CONFIG_MONITOR_DIMENSION_FIELDS)) &&
    (record.sliceBy === null || isAllowedString(record.sliceBy, CONFIG_MONITOR_DIMENSION_FIELDS)) &&
    hasDistinctAxes(record.groupBy, record.sliceBy, record.verticalGroupBy) &&
    hasUniqueAllowedStrings(record.fieldSums, CONFIG_MONITOR_FIELD_SUMS) &&
    hasValidTimezone(record.timezone) &&
    hasValidLocalCardOrder(kanban.localCardOrder) &&
    hasUniqueAllowedStrings(kanban.visibleFieldIds, CONFIG_MONITOR_VISIBLE_FIELDS)
  )
}

const parseStrictMonitorSavedViewConfig = (
  value: unknown,
  ErrorClass: typeof InvalidMonitorViewConfigRequestError | typeof UnsupportedMonitorViewConfigError
): MonitorSavedViewConfig => {
  if (!isObject(value)) {
    throw new ErrorClass()
  }
  if (value.mode === 'executions') {
    if (!hasValidExecutionShape(value)) throw new ErrorClass()
    return normalizeExecutionMonitorViewConfig(value)
  }
  if (value.mode === 'config') {
    if (!hasValidConfigShape(value)) throw new ErrorClass()
    return normalizeConfigMonitorViewConfig(value)
  }
  throw new ErrorClass()
}

export const parseMonitorSavedViewConfig = (value: unknown): MonitorSavedViewConfig =>
  parseStrictMonitorSavedViewConfig(value, InvalidMonitorViewConfigRequestError)

export const assertStoredMonitorSavedViewConfig = (value: unknown): MonitorSavedViewConfig =>
  parseStrictMonitorSavedViewConfig(value, UnsupportedMonitorViewConfigError)

export const getDefaultMonitorViewName = (mode: MonitorPageMode) =>
  mode === 'executions' ? 'Executions' : 'Config'

export const getDefaultMonitorViewConfig = (mode: MonitorPageMode): MonitorSavedViewConfig =>
  mode === 'executions'
    ? normalizeExecutionMonitorViewConfig(DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG)
    : normalizeConfigMonitorViewConfig(DEFAULT_CONFIG_MONITOR_VIEW_CONFIG)

export const getNextMonitorViewName = (rows: MonitorViewRow[], mode: MonitorPageMode) => {
  const baseName = getDefaultMonitorViewName(mode)
  const existingNames = new Set(
    rows
      .filter((row) => row.mode === mode)
      .map((row) => row.name.trim())
      .filter(Boolean)
  )

  if (!existingNames.has(baseName)) {
    return baseName
  }

  let index = 2
  while (existingNames.has(`${baseName} ${index}`)) {
    index += 1
  }
  return `${baseName} ${index}`
}

export const normalizeMonitorShellWorkingState = (value: unknown): MonitorShellWorkingState => {
  if (!isObject(value)) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  const keys = Object.keys(value)
  const requiredKeys = [
    'activeMode',
    'activeViewIdsByMode',
    'executionPanelSizes',
    'configPanelSizes',
  ]
  if (keys.length !== requiredKeys.length || requiredKeys.some((key) => !keys.includes(key))) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  const activeViewIdsByMode: Partial<Record<MonitorPageMode, string | null>> = {}
  const rawActiveViewIdsByMode = value.activeViewIdsByMode
  if (isObject(rawActiveViewIdsByMode)) {
    if (
      Object.keys(rawActiveViewIdsByMode).some((key) => key !== 'executions' && key !== 'config')
    ) {
      return DEFAULT_MONITOR_SHELL_WORKING_STATE
    }

    MONITOR_PAGE_MODES.forEach((mode) => {
      const rawId = rawActiveViewIdsByMode[mode]
      if (rawId === null) {
        activeViewIdsByMode[mode] = null
      } else if (typeof rawId === 'string' && rawId.trim()) {
        activeViewIdsByMode[mode] = rawId.trim()
      }
    })
  }

  return {
    activeMode:
      value.activeMode === 'config' || value.activeMode === 'executions'
        ? value.activeMode
        : DEFAULT_MONITOR_SHELL_WORKING_STATE.activeMode,
    activeViewIdsByMode,
    executionPanelSizes: normalizePanelSizes(value.executionPanelSizes),
    configPanelSizes: normalizePanelSizes(value.configPanelSizes),
  }
}
