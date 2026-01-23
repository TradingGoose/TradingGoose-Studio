import type { IndicatorSeries, IndicatorTemplate } from 'klinecharts'

import averagePrice from './averagePrice'
import awesomeOscillator from './awesomeOscillator'
import bias from './bias'
import bollingerBands from './bollingerBands'
import brar from './brar'
import bullAndBearIndex from './bullAndBearIndex'
import commodityChannelIndex from './commodityChannelIndex'
import currentRatio from './currentRatio'
import differentOfMovingAverage from './differentOfMovingAverage'
import directionalMovementIndex from './directionalMovementIndex'
import easeOfMovementValue from './easeOfMovementValue'
import exponentialMovingAverage from './exponentialMovingAverage'
import momentum from './momentum'
import movingAverage from './movingAverage'
import movingAverageConvergenceDivergence from './movingAverageConvergenceDivergence'
import onBalanceVolume from './onBalanceVolume'
import priceAndVolumeTrend from './priceAndVolumeTrend'
import psychologicalLine from './psychologicalLine'
import rateOfChange from './rateOfChange'
import relativeStrengthIndex from './relativeStrengthIndex'
import simpleMovingAverage from './simpleMovingAverage'
import stoch from './stoch'
import stopAndReverse from './stopAndReverse'
import tripleExponentiallySmoothedAverage from './tripleExponentiallySmoothedAverage'
import volume from './volume'
import volumeRatio from './volumeRatio'
import williamsR from './williamsR'

export type DefaultIndicatorMeta = {
  id: string
  name: string
  series: IndicatorSeries
}

export type AnyIndicatorTemplate = IndicatorTemplate<any, any, any>

export const DEFAULT_INDICATOR_TEMPLATES: AnyIndicatorTemplate[] = [
  averagePrice,
  awesomeOscillator,
  bias,
  bollingerBands,
  brar,
  bullAndBearIndex,
  commodityChannelIndex,
  currentRatio,
  differentOfMovingAverage,
  directionalMovementIndex,
  easeOfMovementValue,
  exponentialMovingAverage,
  momentum,
  movingAverage,
  movingAverageConvergenceDivergence,
  onBalanceVolume,
  priceAndVolumeTrend,
  psychologicalLine,
  rateOfChange,
  relativeStrengthIndex,
  simpleMovingAverage,
  stoch,
  stopAndReverse,
  tripleExponentiallySmoothedAverage,
  volume,
  volumeRatio,
  williamsR,
]

export const DEFAULT_INDICATOR_MAP = new Map<string, AnyIndicatorTemplate>(
  DEFAULT_INDICATOR_TEMPLATES.map((template) => [template.name, template])
)

export const DEFAULT_INDICATORS: DefaultIndicatorMeta[] = DEFAULT_INDICATOR_TEMPLATES.map(
  (template) => ({
    id: template.name,
    name: template.shortName ?? template.name,
    series: (template.series ?? 'normal') as IndicatorSeries,
  })
)

export const isDefaultIndicatorId = (id: string) => DEFAULT_INDICATOR_MAP.has(id)

export const getDefaultIndicatorTemplate = (id: string) =>
  DEFAULT_INDICATOR_MAP.get(id) ?? null
