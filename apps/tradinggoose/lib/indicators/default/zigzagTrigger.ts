import { createDefaultIndicator } from '../create-default-indicator'

const zigzagTrigger = createDefaultIndicator({
  id: 'ZIGZAG_TRIGGER',
  name: 'ZigZag Trigger',
  pineCode: `
indicator('ZigZag Trigger Marker', { overlay: true })

const deviation = input.float(5.0, 'Price deviation for reversals (%)')
const depth = input.int(10, 'Pivot legs')
const showLine = input.bool(true, 'Show ZigZag line')

const pivotHigh = ta.pivothigh(high, depth, depth)
const pivotLow = ta.pivotlow(low, depth, depth)
const pivot = na(pivotHigh) ? (na(pivotLow) ? na : pivotLow) : pivotHigh
const hasPivot = !na(pivotHigh) || !na(pivotLow)
const lastPivot = ta.valuewhen(hasPivot, pivot, 1)
const changePct = lastPivot !== 0 ? ((pivot - lastPivot) / lastPivot) * 100 : na
const isValid = hasPivot && !na(lastPivot) && math.abs(changePct) >= deviation

const longPivot = isValid && !na(pivotLow)
const shortPivot = isValid && !na(pivotHigh)

trigger('zigzag_long', {
  condition: longPivot,
  input: 'zigzag long pivot',
  signal: 'long',
  position: 'belowBar',
  color: '#22c55e',
})

trigger('zigzag_short', {
  condition: shortPivot,
  input: 'zigzag short pivot',
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
  title: 'ZigZag',
  color: '#f59e0b',
  linewidth: 2,
})
`,
})

export default zigzagTrigger
