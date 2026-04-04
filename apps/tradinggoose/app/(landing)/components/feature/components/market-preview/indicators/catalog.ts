import { inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'
import type { InputMetaMap } from '@/lib/indicators/types'

export type LandingMarketIndicatorDefinition = {
  id: string
  name: string
  pineCode: string
  inputMeta?: InputMetaMap
}

export type LandingMarketIndicatorOption = {
  id: string
  name: string
  color: string
  definition: LandingMarketIndicatorDefinition
}

const createLandingMarketIndicatorDefinition = (
  definition: LandingMarketIndicatorDefinition
): LandingMarketIndicatorDefinition => ({
  ...definition,
  inputMeta: definition.inputMeta ?? inferInputMetaFromPineCode(definition.pineCode) ?? undefined,
})

const createLandingMarketIndicatorOption = ({
  id,
  name,
  color,
  pineCode,
}: {
  id: string
  name: string
  color: string
  pineCode: string
}): LandingMarketIndicatorOption => ({
  id,
  name,
  color,
  definition: createLandingMarketIndicatorDefinition({
    id,
    name,
    pineCode,
  }),
})

export const LANDING_MARKET_INDICATOR_OPTIONS: LandingMarketIndicatorOption[] = [
  createLandingMarketIndicatorOption({
    id: 'TREND_RIBBON',
    name: 'Trend Ribbon',
    color: '#14b8a6',
    pineCode: `
indicator('Trend Ribbon', { overlay: true });

const fastLength = input.int(12, 'Fast Length');
const slowLength = input.int(34, 'Slow Length');
const fast = ta.ema(close, fastLength);
const slow = ta.ema(close, slowLength);

const fastPlot = plot(fast, 'Fast Ribbon', { color: '#14b8a6', linewidth: 2 });
const slowPlot = plot(slow, 'Slow Ribbon', { color: '#0ea5e9', linewidth: 2 });
fill(fastPlot, slowPlot);`,
  }),
  createLandingMarketIndicatorOption({
    id: 'MOMENTUM_PRESSURE',
    name: 'Momentum Pressure',
    color: '#8b5cf6',
    pineCode: `
indicator('Momentum Pressure');

const fastLength = input.int(8, 'Fast Length');
const slowLength = input.int(21, 'Slow Length');
const signalLength = input.int(5, 'Signal Length');
const spread = ta.ema(close, fastLength) - ta.ema(close, slowLength);
const signal = ta.ema(spread, signalLength);
const pressure = spread - signal;

plot(pressure, 'Pressure', { style: plot.style_histogram, color: '#8b5cf6' });
plot(signal, 'Signal', { color: '#f97316', linewidth: 2 });
plot(0, 'Baseline', { color: '#64748b' });`,
  }),
  createLandingMarketIndicatorOption({
    id: 'BOLL',
    name: 'Bollinger Bands',
    color: '#f59e0b',
    pineCode: `
indicator('Bollinger Bands', { overlay: true });

const length = input.int(20, 'Length');
const mult = input.float(2, 'StdDev');
const [middle, upper, lower] = ta.bb(close, length, mult);

const upperPlot = plot(upper, 'UP', { color: '#F23645' });
plot(middle, 'MID', { color: '#2962FF' });
const lowerPlot = plot(lower, 'DN', { color: '#089981' });
fill(upperPlot, lowerPlot);`,
  }),
  createLandingMarketIndicatorOption({
    id: 'ST',
    name: 'Supertrend',
    color: '#a855f7',
    pineCode: `
indicator('Supertrend', { overlay: true });

const atrPeriod = input.int(10, 'ATR Length');
const factor = input.float(3, 'Factor');
const [supertrendValue, direction] = ta.supertrend(factor, atrPeriod);
const upTrend = direction < 0 ? supertrendValue : NaN;
const downTrend = direction >= 0 ? supertrendValue : NaN;

plot(upTrend, 'Up Trend');
plot(downTrend, 'Down Trend');`,
  }),
  createLandingMarketIndicatorOption({
    id: 'EMA',
    name: 'Exponential Moving Average',
    color: '#10b981',
    pineCode: `
indicator('Exponential Moving Average', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const ema = ta.ema(close, length);

plot(ema, 'EMA', { offset });`,
  }),
  createLandingMarketIndicatorOption({
    id: 'SMA',
    name: 'Simple Moving Average',
    color: '#38bdf8',
    pineCode: `
indicator('Simple Moving Average', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const sma = ta.sma(close, length);

plot(sma, 'MA', { offset });`,
  }),
  createLandingMarketIndicatorOption({
    id: 'AO',
    name: 'Awesome Oscillator',
    color: '#ef4444',
    pineCode: `
indicator('Awesome Oscillator');

const shortLength = input.int(5, 'Short Length');
const longLength = input.int(34, 'Long Length');
const ao = ta.sma(hl2, shortLength) - ta.sma(hl2, longLength);

plot(ao, 'AO', { style: plot.style_histogram });`,
  }),
  createLandingMarketIndicatorOption({
    id: 'AROON',
    name: 'Aroon',
    color: '#06b6d4',
    pineCode: `
indicator('Aroon');

const length = input.int(14, 'Length');
const highestBars = ta.highestbars(high, length);
const lowestBars = ta.lowestbars(low, length);
const aroonUp = (length + highestBars) / length * 100;
const aroonDown = (length + lowestBars) / length * 100;

plot(aroonUp, 'Aroon Up');
plot(aroonDown, 'Aroon Down');`,
  }),
  createLandingMarketIndicatorOption({
    id: 'VOL',
    name: 'Volume',
    color: '#64748b',
    pineCode: `
indicator('Volume');

plot(volume ?? 0, 'VOLUME', { style: plot.style_histogram });`,
  }),
  createLandingMarketIndicatorOption({
    id: 'ZIGZAG_TRIGGER',
    name: 'Swing Trigger',
    color: '#f97316',
    pineCode: `
indicator('Swing Trigger', { overlay: true })

const deviation = input.float(5.0, 'Price deviation for reversals (%)')
const depth = input.int(10, 'Pivot legs')
const showLine = input.bool(true, 'Show swing line')

const pivotHigh = ta.pivothigh(high, depth, depth)
const pivotLow = ta.pivotlow(low, depth, depth)
const pivot = na(pivotHigh) ? (na(pivotLow) ? na : pivotLow) : pivotHigh
const hasPivot = !na(pivotHigh) || !na(pivotLow)
const lastPivot = ta.valuewhen(hasPivot, pivot, 1)
const changePct = lastPivot !== 0 ? ((pivot - lastPivot) / lastPivot) * 100 : na
const isValid = hasPivot && !na(lastPivot) && math.abs(changePct) >= deviation

const longPivot = isValid && !na(pivotLow)
const shortPivot = isValid && !na(pivotHigh)

trigger('swing_long', {
  condition: longPivot,
  input: 'swing long pivot',
  signal: 'long',
  position: 'belowBar',
  color: '#22c55e',
})

trigger('swing_short', {
  condition: shortPivot,
  input: 'swing short pivot',
  signal: 'short',
  position: 'aboveBar',
  color: '#ef4444',
})

plotshape(longPivot, {
  title: 'Long',
  style: shape.triangleup,
  location: location.belowbar,
  color: '#22c55e',
  size: size.small,
})

plotshape(shortPivot, {
  title: 'Short',
  style: shape.triangledown,
  location: location.abovebar,
  color: '#ef4444',
  size: size.small,
})

plot(showLine && isValid ? pivot : na, {
  title: 'Swing Path',
  color: '#f59e0b',
  linewidth: 2,
})`,
  }),
]

export const LANDING_MARKET_INDICATOR_MAP = new Map(
  LANDING_MARKET_INDICATOR_OPTIONS.map((indicator) => [indicator.id, indicator])
)

export const DEFAULT_LANDING_MARKET_INDICATOR_IDS = ['TREND_RIBBON', 'BOLL', 'MOMENTUM_PRESSURE']
