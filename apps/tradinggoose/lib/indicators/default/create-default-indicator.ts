import type {
  IndicatorFigure,
  IndicatorSeries,
  IndicatorTemplate,
  KLineData,
} from 'klinecharts'
import {
  buildFigureStyles,
  buildPlotRows,
  normalizeIndicatorOutput,
  type IndicatorOutput,
} from '@/lib/indicators/shared/output'

type PlotFigureOverrides = Omit<
  IndicatorFigure,
  'key' | 'title' | 'type' | 'styles'
> & {
  styles?: IndicatorFigure['styles']
}

export type DefaultIndicatorPlot = {
  key: string
  name?: string
  type?: string
  overlay?: boolean
  color?: string
  style?: string
  figure?: PlotFigureOverrides
}

export type DefaultIndicatorDefinition = {
  id: string
  name: string
  series?: IndicatorSeries
  precision?: number
  minValue?: number
  shouldOhlc?: boolean
  shouldFormatBigNumber?: boolean
  plots: DefaultIndicatorPlot[]
  calc: (dataList: KLineData[], indicator: IndicatorTemplate) => IndicatorOutput
}

const toFigure = (plot: DefaultIndicatorPlot): IndicatorFigure => {
  const { figure, key, name, type } = plot
  const { styles: customStyles, ...overrides } = figure ?? {}
  const styles = customStyles ?? buildFigureStyles(plot)

  return {
    key,
    title: name ?? key,
    type: type ?? 'line',
    ...overrides,
    ...(styles ? { styles } : {}),
  }
}

const buildFigures = (plots: DefaultIndicatorPlot[]) => plots.map(toFigure)

export const createDefaultIndicator = (
  definition: DefaultIndicatorDefinition
): IndicatorTemplate => {
  const figures = buildFigures(definition.plots)

  return {
    name: definition.id,
    shortName: definition.name,
    series: definition.series,
    precision: definition.precision,
    minValue: definition.minValue,
    shouldOhlc: definition.shouldOhlc,
    shouldFormatBigNumber: definition.shouldFormatBigNumber,
    figures,
    calc: (dataList, indicator) => {
      const output = definition.calc(dataList, indicator)
      const normalized = normalizeIndicatorOutput(output, dataList.length)
      return buildPlotRows(normalized.plots, dataList.length)
    },
  }
}
