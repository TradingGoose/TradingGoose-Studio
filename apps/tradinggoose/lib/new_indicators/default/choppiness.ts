import { createDefaultPineIndicator } from '../create-default-indicator'

const choppiness = createDefaultPineIndicator({
  id: 'CHOP',
  name: 'Choppiness Index',
  pineCode: `
indicator('Choppiness Index');

const length = input.int(14, 'Length');
const tr = ta.tr(true);
const sumTr = math.sum(tr, length);
const highestHigh = ta.highest(high, length);
const lowestLow = ta.lowest(low, length);
const range = highestHigh - lowestLow;
const chop = range !== 0 ? 100 * math.log10(sumTr / range) / math.log10(length) : NaN;

plot(chop, 'CHOP');`,
})

export default choppiness
