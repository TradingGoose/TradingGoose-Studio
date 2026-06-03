'use client'

import { formatTemplate } from '@/i18n/utils'
import type { Messages } from 'next-intl'

type WorkspaceWidgetsMessages = Messages['workspace']['widgets']
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
import type { MarketRangeUnit } from '@/providers/market/types'
import type {
  DrawToolActionType,
} from '@/widgets/widgets/data_chart/components/draw-tool-icon-registry'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import type { DataChartCandleType } from '@/widgets/widgets/data_chart/types'

export type WorkspaceWidgetsCopy = WorkspaceWidgetsMessages
export type DataChartCopy = WorkspaceWidgetsCopy['dataChart']
export type ListingSelectorCopy = WorkspaceWidgetsCopy['listingSelector']

type UnitCopy = {
  singular: string
  plural: string
}

const INTERVAL_UNIT_BY_CODE = {
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  mo: 'month',
} as const

const getRecordValue = (record: unknown, key: string): string | undefined => {
  if (!record || typeof record !== 'object') return undefined
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const formatUnit = (value: number, unit: UnitCopy) => (value === 1 ? unit.singular : unit.plural)

export function useDataChartCopy() {
  return useWorkspaceWidgetsMessages().dataChart
}

export function useWorkspaceWidgetsCopy() {
  return useWorkspaceWidgetsMessages()
}

export function formatDataChartIntervalLabel(copy: DataChartCopy, interval: string): string {
  const match = interval.match(/^(\d+)(m|h|d|w|mo)$/)
  if (!match) return interval

  const value = Number(match[1])
  const unitKey = INTERVAL_UNIT_BY_CODE[match[2] as keyof typeof INTERVAL_UNIT_BY_CODE]
  const unit = copy.intervalUnits[unitKey]

  return `${value} ${formatUnit(value, unit)}`
}

export function formatDataChartRangeLabel(
  copy: DataChartCopy,
  range: { value: number; unit: MarketRangeUnit }
): string {
  const rawValue = Number(range.value)
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 1
  const unit = copy.footer.range.units[range.unit]

  return `${value} ${formatUnit(value, unit)}`
}

export function formatDataChartRangeIntervalTooltip(
  copy: DataChartCopy,
  range: string,
  interval: string
): string {
  return formatTemplate(copy.footer.range.rangeIntervalTooltip, { range, interval })
}

export function getDataChartRangePresetLabel(copy: DataChartCopy, presetId: string) {
  return getRecordValue(copy.footer.range.presets, presetId) ?? presetId
}

export function getDataChartCandleTypeLabel(
  copy: DataChartCopy,
  candleType: DataChartCandleType
) {
  return getRecordValue(copy.controls.candleTypes, candleType) ?? candleType
}

export function getDataChartDrawToolLabel(copy: DataChartCopy, toolType: ManualToolType) {
  return getRecordValue(copy.drawTools.tools, toolType) ?? toolType
}

export function getDataChartDrawActionLabel(copy: DataChartCopy, action: DrawToolActionType) {
  return getRecordValue(copy.drawTools.actions, action) ?? action
}

export function formatDataChartDrawUnavailable(copy: DataChartCopy, toolLabel: string) {
  return formatTemplate(copy.drawTools.unavailable, { tool: toolLabel })
}

export function getDataChartNormalizationLabel(copy: DataChartCopy, mode: string) {
  const knownLabel = getRecordValue(copy.footer.normalization.modes, mode)
  if (knownLabel) return knownLabel
  return mode.replace(/_/g, ' ')
}

export function formatDataChartNormalizationTooltip(copy: DataChartCopy, modeLabel: string) {
  return formatTemplate(copy.footer.normalization.tooltip, { mode: modeLabel })
}

export function formatDataChartTimezoneTooltip(copy: DataChartCopy, timezone: string) {
  return formatTemplate(copy.footer.timezone.tooltip, { timezone })
}

export function formatDataChartFlagAlt(template: string, countryCode: string) {
  return formatTemplate(template, { countryCode })
}

export function formatDataChartCompileFailed(copy: DataChartCopy, name: string) {
  return formatTemplate(copy.indicator.compileFailed, { name })
}

export function formatDataChartPlotFallback(copy: DataChartCopy, index: number) {
  return formatTemplate(copy.indicator.plotFallback, { index })
}

export function formatDataChartIndicatorPlotFallback(
  indicatorCopy: DataChartCopy['indicator'],
  index: number
) {
  return formatTemplate(indicatorCopy.plotFallback, { index })
}

export function getDataChartIndicatorMetadataLabel(copy: DataChartCopy, label: string) {
  return getRecordValue(copy.indicator.metadataLabels, label) ?? label
}
