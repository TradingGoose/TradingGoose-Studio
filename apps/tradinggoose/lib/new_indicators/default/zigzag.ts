import { createDefaultPineIndicator } from '../create-default-indicator'

const zigzag = createDefaultPineIndicator({
  id: 'ZIGZAG',
  name: 'Zig Zag',
  pineCode: `

indicator('Zig Zag', { overlay: true });

const deviation = input.float(5.0, 'Price deviation for reversals (%)');
const depth = input.int(10, 'Pivot legs');
input.bool(true, 'Extend to last bar');

const pivotHigh = ta.pivothigh(high, depth, depth);
const pivotLow = ta.pivotlow(low, depth, depth);
const pivot = na(pivotHigh) ? (na(pivotLow) ? na : pivotLow) : pivotHigh;
const hasPivot = !na(pivotHigh) || !na(pivotLow);
const lastPivot = ta.valuewhen(hasPivot, pivot, 1);
const changePct = lastPivot !== 0 ? (pivot - lastPivot) / lastPivot * 100 : na;
const isValid = !na(pivot) && (na(lastPivot) || math.abs(changePct) >= deviation);
const zigzagValue = isValid ? pivot : na;

plot(zigzagValue, 'Zig Zag');`,
})

export default zigzag
