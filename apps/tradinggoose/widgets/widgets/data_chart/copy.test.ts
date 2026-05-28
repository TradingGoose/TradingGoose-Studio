import { describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import {
  formatDataChartIntervalLabel,
  formatDataChartRangeIntervalTooltip,
  formatDataChartRangeLabel,
  getDataChartCandleTypeLabel,
  getDataChartNormalizationLabel,
  getDataChartRangePresetLabel,
} from './copy'

describe('data chart copy helpers', () => {
  it('formats interval labels with localized singular and plural units', () => {
    const enCopy = getPublicCopy('en').workspace.widgets.dataChart
    const esCopy = getPublicCopy('es').workspace.widgets.dataChart
    const zhCopy = getPublicCopy('zh-CN').workspace.widgets.dataChart

    expect(formatDataChartIntervalLabel(enCopy, '1m')).toBe('1 minute')
    expect(formatDataChartIntervalLabel(enCopy, '2h')).toBe('2 hours')
    expect(formatDataChartIntervalLabel(esCopy, '1m')).toBe('1 minuto')
    expect(formatDataChartIntervalLabel(esCopy, '2h')).toBe('2 horas')
    expect(formatDataChartIntervalLabel(zhCopy, '2h')).toBe('2 小时')
  })

  it('formats range labels and range interval tooltips from locale copy', () => {
    const enCopy = getPublicCopy('en').workspace.widgets.dataChart
    const esCopy = getPublicCopy('es').workspace.widgets.dataChart
    const zhCopy = getPublicCopy('zh-CN').workspace.widgets.dataChart

    expect(formatDataChartRangeLabel(enCopy, { value: 5, unit: 'day' })).toBe('5 days')
    expect(formatDataChartRangeLabel(esCopy, { value: 1, unit: 'week' })).toBe('1 semana')
    expect(formatDataChartRangeLabel(zhCopy, { value: 3, unit: 'month' })).toBe('3 个月')
    expect(formatDataChartRangeIntervalTooltip(esCopy, '5 días', '1 minuto')).toBe(
      '5 días en intervalo de 1 minuto'
    )
  })

  it('resolves known technical display labels through copy keys', () => {
    const esCopy = getPublicCopy('es').workspace.widgets.dataChart
    const zhCopy = getPublicCopy('zh-CN').workspace.widgets.dataChart

    expect(getDataChartCandleTypeLabel(esCopy, 'area')).toBe('Área')
    expect(getDataChartRangePresetLabel(zhCopy, '1d')).toBe('1日')
    expect(getDataChartNormalizationLabel(esCopy, 'split_adjusted')).toBe('Ajustado por splits')
  })
})
