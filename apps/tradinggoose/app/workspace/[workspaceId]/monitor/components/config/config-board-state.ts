import type { MonitorReferenceData } from '../shared/types'
import type {
  ConfigMonitorDimensionField,
  ConfigMonitorFieldSum,
  ConfigMonitorStatus,
  ConfigMonitorViewConfig,
} from '../view/view-config'
import {
  type ConfigAxisValue,
  type ConfigMonitorCard,
  getConfigCardAxisValue,
} from './config-card-model'
import { sortConfigAxisValues, sortConfigMonitorCards } from './config-ordering'

export type ConfigBoardContext = {
  version: 1
  sliceValue: string
  groupValue: string
  verticalGroupValue: string
  statusLane: ConfigMonitorStatus
}

type ConfigBoardAggregates = Partial<Record<ConfigMonitorFieldSum, number>>

export type ConfigBoardBucket = {
  id: string
  label: string
  context: ConfigBoardContext
  cards: ConfigMonitorCard[]
  aggregates: ConfigBoardAggregates
}

type ConfigBoardStatusLane = {
  id: ConfigMonitorStatus
  label: string
  buckets: ConfigBoardBucket[]
  cards: ConfigMonitorCard[]
  aggregates: ConfigBoardAggregates
}

type ConfigBoardGroup = {
  id: string
  label: string
  statusLanes: ConfigBoardStatusLane[]
  cards: ConfigMonitorCard[]
  aggregates: ConfigBoardAggregates
}

export type ConfigBoardSection = {
  id: string
  label: string
  groups: ConfigBoardGroup[]
  cards: ConfigMonitorCard[]
  aggregates: ConfigBoardAggregates
}

const STATUS_VALUES: Array<{ id: ConfigMonitorStatus; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
]

const DIMENSION_EMPTY_LABELS: Record<ConfigMonitorDimensionField, string> = {
  workflowTarget: 'Workflow target',
  indicator: 'Indicator',
  listing: 'Listing',
  provider: 'Provider',
  interval: 'Interval',
}

const ALL_AXIS_VALUE: ConfigAxisValue = {
  id: 'all',
  label: 'All',
  sortValue: 'All',
}

const aggregateCards = (
  cards: ConfigMonitorCard[],
  fieldSums: ConfigMonitorFieldSum[]
): ConfigBoardAggregates =>
  Object.fromEntries(
    fieldSums.map((field) => [
      field,
      field === 'count'
        ? cards.length
        : field === 'activeCount'
          ? cards.filter((card) => card.isActive).length
          : cards.filter((card) => !card.isActive).length,
    ])
  ) as ConfigBoardAggregates

const encodeConfigBoardBucketId = (context: ConfigBoardContext) =>
  `cfg-bucket:${encodeURIComponent(JSON.stringify(context))}`

const addAxisValue = (values: Map<string, ConfigAxisValue>, value: ConfigAxisValue) => {
  if (!value.id) return
  values.set(value.id, value)
}

const buildAxisValues = (
  field: ConfigMonitorDimensionField,
  cards: ConfigMonitorCard[],
  referenceData: MonitorReferenceData
): ConfigAxisValue[] => {
  const values = new Map<string, ConfigAxisValue>()

  cards.forEach((card) => addAxisValue(values, getConfigCardAxisValue(card, field)))

  if (field === 'workflowTarget') {
    referenceData.workflowTargets.forEach((target) =>
      addAxisValue(values, {
        id: `${target.workflowId}:${target.blockId}`,
        label: target.label,
        sortValue: target.label,
      })
    )
  } else if (field === 'indicator') {
    referenceData.indicatorOptions.forEach((indicator) =>
      addAxisValue(values, {
        id: indicator.id,
        label: indicator.name,
        sortValue: indicator.name,
      })
    )
  } else if (field === 'provider') {
    referenceData.streamingProviders.forEach((provider) =>
      addAxisValue(values, {
        id: provider.id,
        label: provider.name,
        sortValue: provider.name,
      })
    )
  } else if (field === 'interval') {
    Object.values(referenceData.providerIntervalsByProviderId)
      .flat()
      .forEach((interval) =>
        addAxisValue(values, {
          id: interval,
          label: interval,
          sortValue: interval,
        })
      )
  }

  const sortedValues = sortConfigAxisValues(Array.from(values.values()))
  if (sortedValues.length > 0) {
    return sortedValues
  }

  return [
    {
      id: 'all',
      label: DIMENSION_EMPTY_LABELS[field],
      sortValue: DIMENSION_EMPTY_LABELS[field],
    },
  ]
}

const filterCardsByAxis = (
  cards: ConfigMonitorCard[],
  field: ConfigMonitorDimensionField | null,
  value: string
) => {
  if (!field || value === 'all') return cards
  return cards.filter((card) => getConfigCardAxisValue(card, field).id === value)
}

export const buildConfigBoardSections = (
  cards: ConfigMonitorCard[],
  config: ConfigMonitorViewConfig,
  referenceData: MonitorReferenceData
): ConfigBoardSection[] => {
  const sectionValues = config.sliceBy
    ? buildAxisValues(config.sliceBy, cards, referenceData)
    : [{ ...ALL_AXIS_VALUE, label: 'All monitors', sortValue: 'All monitors' }]
  const groupValues = buildAxisValues(config.groupBy, cards, referenceData)
  const verticalValues = config.verticalGroupBy
    ? buildAxisValues(config.verticalGroupBy, cards, referenceData)
    : [ALL_AXIS_VALUE]

  return sectionValues.map((sectionValue) => {
    const sectionCards = filterCardsByAxis(cards, config.sliceBy, sectionValue.id)

    const groups = groupValues.map((groupValue) => {
      const groupCards = filterCardsByAxis(sectionCards, config.groupBy, groupValue.id)

      const statusLanes = STATUS_VALUES.map((status) => {
        const laneCards = groupCards.filter((card) => card.status === status.id)

        const buckets = verticalValues.map((verticalValue) => {
          const bucketCards = filterCardsByAxis(laneCards, config.verticalGroupBy, verticalValue.id)
          const context: ConfigBoardContext = {
            version: 1,
            sliceValue: sectionValue.id,
            groupValue: groupValue.id,
            verticalGroupValue: verticalValue.id,
            statusLane: status.id,
          }
          const bucketId = encodeConfigBoardBucketId(context)

          return {
            id: bucketId,
            label: verticalValue.label,
            context,
            cards: sortConfigMonitorCards(
              bucketCards,
              config.sortBy,
              config.kanban.localCardOrder[bucketId] ?? []
            ),
            aggregates: aggregateCards(bucketCards, config.fieldSums),
          } satisfies ConfigBoardBucket
        })

        return {
          id: status.id,
          label: status.label,
          buckets,
          cards: laneCards,
          aggregates: aggregateCards(laneCards, config.fieldSums),
        } satisfies ConfigBoardStatusLane
      })

      return {
        id: groupValue.id,
        label: groupValue.label,
        statusLanes,
        cards: groupCards,
        aggregates: aggregateCards(groupCards, config.fieldSums),
      } satisfies ConfigBoardGroup
    })

    return {
      id: sectionValue.id,
      label: sectionValue.label,
      groups,
      cards: sectionCards,
      aggregates: aggregateCards(sectionCards, config.fieldSums),
    } satisfies ConfigBoardSection
  })
}
