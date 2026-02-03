import averagePrice from './averagePrice'
import awesomeOscillator from './awesomeOscillator'
import bias from './bias'
import bollingerBands from './bollingerBands'
import brar from './brar'
import bullAndBearIndex from './bullAndBearIndex'
import commodityChannelIndex from './commodityChannelIndex'
import type { DefaultPineIndicatorDefinition } from './create-default-indicator'
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

export type DefaultPineIndicatorMeta = {
  id: string
  name: string
}

export const DEFAULT_PINE_INDICATORS: DefaultPineIndicatorDefinition[] = [
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

export const DEFAULT_PINE_INDICATOR_MAP = new Map(
  DEFAULT_PINE_INDICATORS.map((indicator) => [indicator.id, indicator])
)

export const DEFAULT_PINE_INDICATORS_META: DefaultPineIndicatorMeta[] = DEFAULT_PINE_INDICATORS.map(
  (indicator) => ({
    id: indicator.id,
    name: indicator.name,
  })
)

export const isDefaultPineIndicatorId = (id: string) => DEFAULT_PINE_INDICATOR_MAP.has(id)

export const getDefaultPineIndicator = (id: string) => DEFAULT_PINE_INDICATOR_MAP.get(id) ?? null
