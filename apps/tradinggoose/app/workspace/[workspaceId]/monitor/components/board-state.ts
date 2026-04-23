import { getListingPrimary } from '@/components/listing-selector/listing/row'
import type { ListingOption } from '@/lib/listing/identity'
import { getMarketProviderParamDefinitions } from '@/providers/market/providers'
import { getTrigger } from '@/triggers'
import type {
  IndicatorMonitorRecord,
  IndicatorOption,
  StreamingProviderOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from './types'
import {
  type MonitorGroupBy,
  type MonitorSortField,
  type MonitorViewConfig,
  type MonitorVisibleFields,
} from './view-config'
import { isAuthParamDefinition, parseIntervalDurationMs } from './utils'

export const MONITOR_PRIMARY_STATUS_ORDER = [
  'running',
  'paused',
  'needs_deploy',
  'missing_auth',
] as const

export type MonitorPrimaryStatus = (typeof MONITOR_PRIMARY_STATUS_ORDER)[number]

export type MonitorEntity = {
  id: string
  monitor: IndicatorMonitorRecord
  workflowName: string
  workflowColor: string
  workflowTarget: WorkflowTargetOption | null
  indicatorName: string
  indicatorColor: string
  providerName: string
  providerIcon: StreamingProviderOption['icon'] | undefined
  triggerId: string
  triggerName: string
  listingOption: ListingOption | null
  listingLabel: string
  listingSortKey: string
  assetTypeKey: string
  assetTypeLabel: string
  primaryStatus: MonitorPrimaryStatus
  secondaryStatuses: Extract<MonitorPrimaryStatus, 'needs_deploy' | 'missing_auth'>[]
  authConfigured: boolean
  needsDeploy: boolean
  canPause: boolean
  canResume: boolean
  updatedAtDate: Date
  createdAtDate: Date
}

export type MonitorBoardColumn = {
  id: string
  label: string
  items: MonitorEntity[]
}

export type MonitorFilterOption = {
  value: string
  label: string
}

export type MonitorFilterOptions = {
  triggers: MonitorFilterOption[]
  providers: MonitorFilterOption[]
  intervals: MonitorFilterOption[]
  assetTypes: MonitorFilterOption[]
}

const dedupeStrings = (values: string[]) => {
  const unique = new Set<string>()

  values.forEach((value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed || unique.has(trimmed)) return
    unique.add(trimmed)
  })

  return Array.from(unique)
}

const STATUS_LABELS: Record<MonitorPrimaryStatus, string> = {
  running: 'Running',
  paused: 'Paused',
  needs_deploy: 'Needs Deploy',
  missing_auth: 'Missing Auth',
}

const STATUS_COLORS: Record<MonitorPrimaryStatus, string> = {
  running: '#22c55e',
  paused: '#94a3b8',
  needs_deploy: '#f59e0b',
  missing_auth: '#ef4444',
}

type BuildMonitorEntitiesInput = {
  monitors: IndicatorMonitorRecord[]
  workflowTargets: WorkflowTargetOption[]
  workflows: WorkflowPickerOption[]
  indicators: IndicatorOption[]
  providers: StreamingProviderOption[]
}

type MonitorGroupDescriptor = {
  id: string
  label: string
  sortKey: string
  sortValue: string
}

type MonitorListingValue = IndicatorMonitorRecord['providerConfig']['monitor']['listing'] & {
  base?: string
  quote?: string | null
  name?: string | null
  iconUrl?: string | null
  assetClass?: string | null
  countryCode?: string | null
}

const toListingOption = (
  listing: IndicatorMonitorRecord['providerConfig']['monitor']['listing']
): ListingOption | null => {
  const value = listing as MonitorListingValue
  const identityBase =
    value.listing_type === 'default' ? value.listing_id?.trim() : value.base_id?.trim()
  const identityQuote = value.listing_type === 'default' ? '' : value.quote_id?.trim()
  const base = (typeof value.base === 'string' ? value.base.trim() : '') || identityBase || ''
  if (!base) return null

  const quote = (typeof value.quote === 'string' ? value.quote.trim() : '') || identityQuote || ''

  return {
    ...listing,
    base,
    quote: quote || null,
    name: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : null,
    iconUrl: typeof value.iconUrl === 'string' ? value.iconUrl : null,
    assetClass: typeof value.assetClass === 'string' ? value.assetClass : null,
    countryCode: typeof value.countryCode === 'string' ? value.countryCode : null,
  }
}

const getListingLabel = (
  listing: IndicatorMonitorRecord['providerConfig']['monitor']['listing']
): string => {
  const option = toListingOption(listing)
  if (option) {
    const primary = getListingPrimary(option)
    return option.quote ? `${primary}/${option.quote}` : primary
  }

  if (listing.listing_type === 'default') {
    return listing.listing_id.trim() || 'Listing'
  }

  const base = listing.base_id.trim()
  const quote = listing.quote_id.trim()
  if (base && quote) {
    return `${base}/${quote}`
  }

  return base || quote || 'Listing'
}

const getListingSortKey = (
  listing: IndicatorMonitorRecord['providerConfig']['monitor']['listing']
): string => {
  const displayLabel = getListingLabel(listing).trim()
  if (displayLabel && displayLabel !== 'Listing') {
    return displayLabel.toLowerCase()
  }

  if (listing.listing_type === 'default') {
    return listing.listing_id.trim().toLowerCase()
  }

  return `${listing.base_id.trim()}/${listing.quote_id.trim()}`.toLowerCase()
}

const getAssetTypeValue = (
  listing: IndicatorMonitorRecord['providerConfig']['monitor']['listing']
): { key: string; label: string } => {
  const record = listing as Record<string, unknown>

  const value =
    (typeof record.assetClass === 'string' && record.assetClass.trim()) ||
    (typeof record.base_asset_class === 'string' && record.base_asset_class.trim()) ||
    (typeof record.listing_type === 'string' && record.listing_type.trim()) ||
    'unknown'

  return {
    key: value.toLowerCase(),
    label: value.toUpperCase(),
  }
}

const providerRequiresAuth = (providerId: string) =>
  getMarketProviderParamDefinitions(providerId, 'live').some(
    (definition) => definition.required && isAuthParamDefinition(definition)
  )

const getPrimaryStatus = ({
  authConfigured,
  needsDeploy,
  isActive,
}: {
  authConfigured: boolean
  needsDeploy: boolean
  isActive: boolean
}): MonitorPrimaryStatus => {
  if (!authConfigured) return 'missing_auth'
  if (needsDeploy) return 'needs_deploy'
  return isActive ? 'running' : 'paused'
}

const compareStrings = (left: string, right: string) =>
  left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' })

const compareDatesAsc = (left: Date, right: Date) => left.getTime() - right.getTime()
const compareDatesDesc = (left: Date, right: Date) => right.getTime() - left.getTime()

const compareIntervals = (left: string, right: string) => {
  const leftDuration = parseIntervalDurationMs(left)
  const rightDuration = parseIntervalDurationMs(right)

  if (leftDuration != null && rightDuration != null && leftDuration !== rightDuration) {
    return leftDuration - rightDuration
  }

  return compareStrings(left, right)
}

const compareEntitiesByField = (
  left: MonitorEntity,
  right: MonitorEntity,
  field: MonitorSortField,
  groupBy: MonitorGroupBy
) => {
  switch (field) {
    case 'listingLabel': {
      const listingResult = compareStrings(left.listingSortKey, right.listingSortKey)
      if (listingResult !== 0) return listingResult
      if (groupBy === 'listing') {
        return compareDatesAsc(left.updatedAtDate, right.updatedAtDate)
      }
      return compareStrings(left.workflowName, right.workflowName)
    }
    case 'workflowName': {
      const workflowResult = compareStrings(left.workflowName, right.workflowName)
      return workflowResult !== 0
        ? workflowResult
        : compareDatesAsc(left.updatedAtDate, right.updatedAtDate)
    }
    case 'providerId': {
      const providerResult = compareStrings(
        left.monitor.providerConfig.monitor.providerId,
        right.monitor.providerConfig.monitor.providerId
      )
      return providerResult !== 0
        ? providerResult
        : compareDatesAsc(left.updatedAtDate, right.updatedAtDate)
    }
    case 'interval': {
      const intervalResult = compareIntervals(
        left.monitor.providerConfig.monitor.interval,
        right.monitor.providerConfig.monitor.interval
      )
      return intervalResult !== 0
        ? intervalResult
        : compareDatesAsc(left.updatedAtDate, right.updatedAtDate)
    }
    case 'updatedAt':
    default:
      return compareDatesAsc(left.updatedAtDate, right.updatedAtDate)
  }
}

const getGroupDescriptor = (
  entity: MonitorEntity,
  groupBy: MonitorGroupBy
): MonitorGroupDescriptor => {
  switch (groupBy) {
    case 'workflow':
      return {
        id: entity.monitor.workflowId,
        label: entity.workflowName,
        sortKey: entity.workflowName.toLowerCase(),
        sortValue: entity.workflowName,
      }
    case 'trigger':
      return {
        id: entity.triggerId,
        label: entity.triggerName,
        sortKey: entity.triggerName.toLowerCase(),
        sortValue: entity.triggerName,
      }
    case 'listing':
      return {
        id: entity.listingSortKey || entity.monitor.monitorId,
        label: entity.listingLabel,
        sortKey: entity.listingLabel.toLowerCase(),
        sortValue: entity.listingSortKey,
      }
    case 'assetType':
      return {
        id: entity.assetTypeKey,
        label: entity.assetTypeLabel,
        sortKey: entity.assetTypeKey,
        sortValue: entity.assetTypeKey,
      }
    case 'provider':
      return {
        id: entity.monitor.providerConfig.monitor.providerId,
        label: entity.providerName,
        sortKey: entity.providerName.toLowerCase(),
        sortValue: entity.monitor.providerConfig.monitor.providerId,
      }
    case 'interval':
      return {
        id: entity.monitor.providerConfig.monitor.interval,
        label: entity.monitor.providerConfig.monitor.interval,
        sortKey: entity.monitor.providerConfig.monitor.interval.toLowerCase(),
        sortValue: entity.monitor.providerConfig.monitor.interval,
      }
    case 'status':
    default:
      return {
        id: entity.primaryStatus,
        label: STATUS_LABELS[entity.primaryStatus],
        sortKey: entity.primaryStatus,
        sortValue: entity.primaryStatus,
      }
  }
}

export const getMonitorStatusLabel = (status: MonitorPrimaryStatus) => STATUS_LABELS[status]

export const getMonitorStatusColor = (status: MonitorPrimaryStatus) => STATUS_COLORS[status]

export const buildMonitorEntities = ({
  monitors,
  workflowTargets,
  workflows,
  indicators,
  providers,
}: BuildMonitorEntitiesInput): MonitorEntity[] => {
  const workflowTargetByKey = new Map(
    workflowTargets.map((target) => [`${target.workflowId}:${target.blockId}`, target] as const)
  )
  const workflowById = new Map(
    workflows.map((workflow) => [workflow.workflowId, workflow] as const)
  )
  const indicatorById = new Map(indicators.map((indicator) => [indicator.id, indicator] as const))
  const providerById = new Map(providers.map((provider) => [provider.id, provider] as const))

  return monitors.map((monitor) => {
    const workflowTarget =
      workflowTargetByKey.get(`${monitor.workflowId}:${monitor.blockId}`) ?? null
    const triggerId = monitor.providerConfig.triggerId.trim() || 'indicator_trigger'
    const triggerName = getTrigger(triggerId)?.name || triggerId
    const workflow = workflowById.get(monitor.workflowId)
    const indicator = indicatorById.get(monitor.providerConfig.monitor.indicatorId)
    const provider = providerById.get(monitor.providerConfig.monitor.providerId)
    const listingOption = toListingOption(monitor.providerConfig.monitor.listing)
    const listingLabel = getListingLabel(monitor.providerConfig.monitor.listing)
    const listingSortKey = getListingSortKey(monitor.providerConfig.monitor.listing)
    const assetType = getAssetTypeValue(monitor.providerConfig.monitor.listing)
    const requiresAuth = providerRequiresAuth(monitor.providerConfig.monitor.providerId)
    const authConfigured = requiresAuth
      ? Boolean(monitor.providerConfig.monitor.auth?.hasEncryptedSecrets)
      : true
    const needsDeploy = workflowTarget === null
    const primaryStatus = getPrimaryStatus({
      authConfigured,
      needsDeploy,
      isActive: monitor.isActive,
    })
    const secondaryStatuses: MonitorEntity['secondaryStatuses'] = []

    if (primaryStatus !== 'missing_auth' && !authConfigured) {
      secondaryStatuses.push('missing_auth')
    }
    if (primaryStatus !== 'needs_deploy' && needsDeploy) {
      secondaryStatuses.push('needs_deploy')
    }

    return {
      id: monitor.monitorId,
      monitor,
      workflowName: workflowTarget?.workflowName || workflow?.workflowName || monitor.workflowId,
      workflowColor: workflowTarget?.workflowColor || workflow?.workflowColor || '#3972F6',
      workflowTarget,
      indicatorName: indicator?.name || monitor.providerConfig.monitor.indicatorId,
      indicatorColor: indicator?.color || '#3972F6',
      providerName: provider?.name || monitor.providerConfig.monitor.providerId,
      providerIcon: provider?.icon,
      triggerId,
      triggerName,
      listingOption,
      listingLabel,
      listingSortKey,
      assetTypeKey: assetType.key,
      assetTypeLabel: assetType.label,
      primaryStatus,
      secondaryStatuses,
      authConfigured,
      needsDeploy,
      canPause:
        primaryStatus !== 'missing_auth' && primaryStatus !== 'needs_deploy' && monitor.isActive,
      canResume:
        primaryStatus !== 'missing_auth' && primaryStatus !== 'needs_deploy' && !monitor.isActive,
      updatedAtDate: new Date(monitor.updatedAt),
      createdAtDate: new Date(monitor.createdAt),
    }
  })
}

export const getMonitorFilterOptions = (entities: MonitorEntity[]): MonitorFilterOptions => {
  const triggerMap = new Map<string, string>()
  const providerMap = new Map<string, string>()
  const intervalMap = new Map<string, string>()
  const assetTypeMap = new Map<string, string>()

  entities.forEach((entity) => {
    triggerMap.set(entity.triggerId, entity.triggerName)
    providerMap.set(entity.monitor.providerConfig.monitor.providerId, entity.providerName)
    intervalMap.set(
      entity.monitor.providerConfig.monitor.interval,
      entity.monitor.providerConfig.monitor.interval
    )
    assetTypeMap.set(entity.assetTypeKey, entity.assetTypeLabel)
  })

  const toOptions = (map: Map<string, string>, compare = compareStrings) =>
    Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => compare(left.label, right.label))

  return {
    triggers: toOptions(triggerMap),
    providers: toOptions(providerMap),
    intervals: toOptions(intervalMap, compareIntervals),
    assetTypes: toOptions(assetTypeMap),
  }
}

export const filterMonitorEntities = (
  entities: MonitorEntity[],
  config: MonitorViewConfig,
  search: string
) => {
  const normalizedSearch = search.trim().toLowerCase()

  return entities.filter((entity) => {
    const matchesWorkflow =
      !config.filters.workflowId || entity.monitor.workflowId === config.filters.workflowId

    const matchesAttention = !config.filters.attentionOnly
      ? true
      : entity.primaryStatus === 'missing_auth' || entity.primaryStatus === 'needs_deploy'

    const matchesTrigger =
      config.filters.triggerIds.length === 0 || config.filters.triggerIds.includes(entity.triggerId)

    const matchesProvider =
      config.filters.providerIds.length === 0 ||
      config.filters.providerIds.includes(entity.monitor.providerConfig.monitor.providerId)

    const matchesInterval =
      config.filters.intervals.length === 0 ||
      config.filters.intervals.includes(entity.monitor.providerConfig.monitor.interval)

    const matchesAssetType =
      config.filters.assetTypes.length === 0 ||
      config.filters.assetTypes.includes(entity.assetTypeKey)

    const matchesSearch =
      normalizedSearch.length === 0 ||
      [
        entity.listingLabel,
        entity.indicatorName,
        entity.workflowName,
        entity.providerName,
        entity.monitor.providerConfig.monitor.providerId,
        entity.triggerName,
        entity.monitor.providerConfig.monitor.interval,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)

    return (
      matchesWorkflow &&
      matchesAttention &&
      matchesTrigger &&
      matchesProvider &&
      matchesInterval &&
      matchesAssetType &&
      matchesSearch
    )
  })
}

const sortMonitorEntities = (
  entities: MonitorEntity[],
  field: MonitorSortField,
  direction: MonitorViewConfig['sort']['direction'],
  groupBy: MonitorGroupBy
) => {
  const directionFactor = direction === 'asc' ? 1 : -1

  return [...entities].sort(
    (left, right) => compareEntitiesByField(left, right, field, groupBy) * directionFactor
  )
}

const compareBoardColumns = (
  left: MonitorBoardColumn & { sortKey: string; sortValue: string },
  right: MonitorBoardColumn & { sortKey: string; sortValue: string },
  config: MonitorViewConfig
) => {
  const directionFactor = config.sort.direction === 'asc' ? 1 : -1

  if (config.board.groupBy === 'workflow' && config.sort.field === 'workflowName') {
    return compareStrings(left.sortValue, right.sortValue) * directionFactor
  }

  if (config.board.groupBy === 'listing' && config.sort.field === 'listingLabel') {
    return compareStrings(left.sortValue, right.sortValue) * directionFactor
  }

  if (config.board.groupBy === 'provider' && config.sort.field === 'providerId') {
    return compareStrings(left.sortValue, right.sortValue) * directionFactor
  }

  if (config.board.groupBy === 'interval' && config.sort.field === 'interval') {
    return compareIntervals(left.sortValue, right.sortValue) * directionFactor
  }

  return compareStrings(left.sortKey, right.sortKey)
}

const applyStatusBoardCardOrder = (entities: MonitorEntity[], cardOrder: string[]) => {
  const normalizedOrder = dedupeStrings(cardOrder)

  if (normalizedOrder.length === 0) {
    return entities
  }

  const orderIndex = new Map(normalizedOrder.map((id, index) => [id, index] as const))

  return entities
    .map((entity, index) => ({
      entity,
      index,
      orderIndex: orderIndex.get(entity.id) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (left.orderIndex !== right.orderIndex) {
        return left.orderIndex - right.orderIndex
      }

      return left.index - right.index
    })
    .map(({ entity }) => entity)
}

export const mergeVisibleStatusBoardCardOrder = (
  currentOrder: string[],
  nextVisibleOrder: string[]
) => {
  const normalizedCurrent = dedupeStrings(currentOrder)
  const normalizedVisible = dedupeStrings(nextVisibleOrder)
  const visibleSet = new Set(normalizedVisible)
  const remainingVisible = [...normalizedVisible]
  const merged: string[] = []
  const mergedSet = new Set<string>()

  normalizedCurrent.forEach((id) => {
    if (visibleSet.has(id)) {
      const replacement = remainingVisible.shift()

      if (replacement && !mergedSet.has(replacement)) {
        merged.push(replacement)
        mergedSet.add(replacement)
      }

      return
    }

    if (!mergedSet.has(id)) {
      merged.push(id)
      mergedSet.add(id)
    }
  })

  remainingVisible.forEach((id) => {
    if (!mergedSet.has(id)) {
      merged.push(id)
      mergedSet.add(id)
    }
  })

  return merged
}

export const buildMonitorBoardColumns = (
  entities: MonitorEntity[],
  config: MonitorViewConfig
): MonitorBoardColumn[] => {
  const sortedEntities = sortMonitorEntities(
    entities,
    config.sort.field,
    config.sort.direction,
    config.board.groupBy
  )

  if (config.board.groupBy === 'status') {
    const grouped = new Map<string, MonitorEntity[]>()
    applyStatusBoardCardOrder(sortedEntities, config.board.cardOrder).forEach((entity) => {
      const existing = grouped.get(entity.primaryStatus) ?? []
      existing.push(entity)
      grouped.set(entity.primaryStatus, existing)
    })

    const renderedStatuses = config.filters.attentionOnly
      ? (['missing_auth', 'needs_deploy'] as MonitorPrimaryStatus[])
      : MONITOR_PRIMARY_STATUS_ORDER

    return renderedStatuses.map((status) => ({
      id: status,
      label: STATUS_LABELS[status],
      items: grouped.get(status) ?? [],
    }))
  }

  const grouped = new Map<string, MonitorBoardColumn & { sortKey: string; sortValue: string }>()

  sortedEntities.forEach((entity) => {
    const descriptor = getGroupDescriptor(entity, config.board.groupBy)
    const current =
      grouped.get(descriptor.id) ??
      ({
        id: descriptor.id,
        label: descriptor.label,
        sortKey: descriptor.sortKey,
        sortValue: descriptor.sortValue,
        items: [],
      } as MonitorBoardColumn & { sortKey: string; sortValue: string })

    current.items.push(entity)
    grouped.set(descriptor.id, current)
  })

  return Array.from(grouped.values())
    .map((column) => {
      if (config.board.groupBy === 'listing' && config.sort.field === 'listingLabel') {
        column.items = [...column.items].sort((left, right) =>
          compareDatesDesc(left.updatedAtDate, right.updatedAtDate)
        )
      }

      return column
    })
    .sort((left, right) => compareBoardColumns(left, right, config))
    .map(({ id, label, items }) => ({ id, label, items }))
}

export const shouldEnableTriggerControls = (entities: MonitorEntity[]) =>
  new Set(entities.map((entity) => entity.triggerId)).size > 1

export const getDefaultPanelSizes = (layout: MonitorViewConfig['layout']) =>
  layout === 'board' ? [76, 24] : [76, 24]

export const shouldShowField = (
  visibleFields: MonitorVisibleFields,
  field: keyof MonitorVisibleFields
) => visibleFields[field]
