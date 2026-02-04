import adr from './adr'
import adx from './adx'
import alma from './alma'
import aroon from './aroon'
import atr from './atr'
import averagePrice from './averagePrice'
import awesomeOscillator from './awesomeOscillator'
import bbBandwidth from './bbBandwidth'
import bbPercentB from './bbPercentB'
import bbTrend from './bbTrend'
import bias from './bias'
import bollingerBands from './bollingerBands'
import bop from './bop'
import brar from './brar'
import bullAndBearIndex from './bullAndBearIndex'
import bullBearPower from './bullBearPower'
import chaikinMf from './chaikinMf'
import chaikinOscillator from './chaikinOscillator'
import chandeKrollStop from './chandeKrollStop'
import chandeMo from './chandeMo'
import choppiness from './choppiness'
import commodityChannelIndex from './commodityChannelIndex'
import coppockCurve from './coppockCurve'
import cumulativeVolumeDelta from './cumulativeVolumeDelta'
import currentRatio from './currentRatio'
import dema from './dema'
import differentOfMovingAverage from './differentOfMovingAverage'
import directionalMovementIndex from './directionalMovementIndex'
import donchian from './donchian'
import dpo from './dpo'
import easeOfMovementValue from './easeOfMovementValue'
import elderForce from './elderForce'
import envelope from './envelope'
import exponentialMovingAverage from './exponentialMovingAverage'
import fisherTransform from './fisherTransform'
import historicalVolatility from './historicalVolatility'
import hma from './hma'
import ichimoku from './ichimoku'
import keltner from './keltner'
import klinger from './klinger'
import lsma from './lsma'
import maCross from './maCross'
import maRibbon from './maRibbon'
import massIndex from './massIndex'
import mcginleyDynamic from './mcginleyDynamic'
import median from './median'
import mfi from './mfi'
import momentum from './momentum'
import movingAverage from './movingAverage'
import movingAverageConvergenceDivergence from './movingAverageConvergenceDivergence'
import netVolume from './netVolume'
import onBalanceVolume from './onBalanceVolume'
import priceAndVolumeTrend from './priceAndVolumeTrend'
import priceOscillator from './priceOscillator'
import psychologicalLine from './psychologicalLine'
import rateOfChange from './rateOfChange'
import rciRibbon from './rciRibbon'
import relativeStrengthIndex from './relativeStrengthIndex'
import relativeVolumeAtTime from './relativeVolumeAtTime'
import rma from './rma'
import rvi from './rvi'
import simpleMovingAverage from './simpleMovingAverage'
import smiErgodic from './smiErgodic'
import smiErgodicOscillator from './smiErgodicOscillator'
import smma from './smma'
import stdev from './stdev'
import stoch from './stoch'
import stochRsi from './stochRsi'
import stopAndReverse from './stopAndReverse'
import supertrend from './supertrend'
import tema from './tema'
import trendStrength from './trendStrength'
import tripleExponentiallySmoothedAverage from './tripleExponentiallySmoothedAverage'
import tsi from './tsi'
import ultimateOscillator from './ultimateOscillator'
import volume from './volume'
import volumeDelta from './volumeDelta'
import volumeOscillator from './volumeOscillator'
import volumeRatio from './volumeRatio'
import vortex from './vortex'
import vwma from './vwma'
import williamsAlligator from './williamsAlligator'
import williamsR from './williamsR'
import wma from './wma'
import woodiesCci from './woodiesCci'
import zigzag from './zigzag'
import type { DefaultPineIndicatorDefinition } from '../create-default-indicator'

export type DefaultPineIndicatorMeta = {
  id: string
  name: string
}

export const DEFAULT_PINE_INDICATORS: DefaultPineIndicatorDefinition[] = [
  adr,
  adx,
  alma,
  aroon,
  atr,
  averagePrice,
  awesomeOscillator,
  bbBandwidth,
  bbPercentB,
  bbTrend,
  bias,
  bollingerBands,
  bop,
  brar,
  bullAndBearIndex,
  bullBearPower,
  chaikinMf,
  chaikinOscillator,
  chandeKrollStop,
  chandeMo,
  choppiness,
  commodityChannelIndex,
  coppockCurve,
  cumulativeVolumeDelta,
  currentRatio,
  dema,
  differentOfMovingAverage,
  directionalMovementIndex,
  donchian,
  dpo,
  easeOfMovementValue,
  elderForce,
  envelope,
  exponentialMovingAverage,
  fisherTransform,
  historicalVolatility,
  hma,
  ichimoku,
  keltner,
  klinger,
  lsma,
  maCross,
  maRibbon,
  massIndex,
  mcginleyDynamic,
  median,
  mfi,
  momentum,
  movingAverage,
  movingAverageConvergenceDivergence,
  netVolume,
  onBalanceVolume,
  priceAndVolumeTrend,
  priceOscillator,
  psychologicalLine,
  rateOfChange,
  rciRibbon,
  relativeStrengthIndex,
  relativeVolumeAtTime,
  rma,
  rvi,
  simpleMovingAverage,
  smiErgodic,
  smiErgodicOscillator,
  smma,
  stdev,
  stoch,
  stochRsi,
  stopAndReverse,
  supertrend,
  tema,
  trendStrength,
  tripleExponentiallySmoothedAverage,
  tsi,
  ultimateOscillator,
  volume,
  volumeDelta,
  volumeOscillator,
  volumeRatio,
  vortex,
  vwma,
  williamsAlligator,
  williamsR,
  wma,
  woodiesCci,
  zigzag,
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
