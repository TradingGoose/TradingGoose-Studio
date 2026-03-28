import type { DefaultIndicatorDefinition } from '@/lib/indicators/create-default-indicator'
import aroon from '@/lib/indicators/default/aroon'
import awesomeOscillator from '@/lib/indicators/default/awesomeOscillator'
import bollingerBands from '@/lib/indicators/default/bollingerBands'
import exponentialMovingAverage from '@/lib/indicators/default/exponentialMovingAverage'
import simpleMovingAverage from '@/lib/indicators/default/simpleMovingAverage'
import supertrend from '@/lib/indicators/default/supertrend'
import volume from '@/lib/indicators/default/volume'
import zigzagTrigger from '@/lib/indicators/default/zigzagTrigger'

export type LandingMarketIndicatorOption = {
  id: string
  name: string
  color: string
  definition: DefaultIndicatorDefinition
}

export const LANDING_MARKET_INDICATOR_OPTIONS: LandingMarketIndicatorOption[] = [
  {
    id: exponentialMovingAverage.id,
    name: exponentialMovingAverage.name,
    color: '#10b981',
    definition: exponentialMovingAverage,
  },
  {
    id: simpleMovingAverage.id,
    name: simpleMovingAverage.name,
    color: '#38bdf8',
    definition: simpleMovingAverage,
  },
  {
    id: supertrend.id,
    name: supertrend.name,
    color: '#8b5cf6',
    definition: supertrend,
  },
  {
    id: bollingerBands.id,
    name: bollingerBands.name,
    color: '#f59e0b',
    definition: bollingerBands,
  },
  {
    id: awesomeOscillator.id,
    name: awesomeOscillator.name,
    color: '#ef4444',
    definition: awesomeOscillator,
  },
  {
    id: aroon.id,
    name: aroon.name,
    color: '#06b6d4',
    definition: aroon,
  },
  {
    id: volume.id,
    name: volume.name,
    color: '#64748b',
    definition: volume,
  },
  {
    id: zigzagTrigger.id,
    name: zigzagTrigger.name,
    color: '#f59e0b',
    definition: zigzagTrigger,
  },
]

export const LANDING_MARKET_INDICATOR_MAP = new Map(
  LANDING_MARKET_INDICATOR_OPTIONS.map((indicator) => [indicator.id, indicator])
)

export const DEFAULT_LANDING_MARKET_INDICATOR_IDS = [
  zigzagTrigger.id,
  bollingerBands.id,
  volume.id,
]
