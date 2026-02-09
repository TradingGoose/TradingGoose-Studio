import { createDefaultIndicator } from '../create-default-indicator'

const chandeKrollStop = createDefaultIndicator({
  id: 'CKS',
  name: 'Chande Kroll Stop',
  pineCode: `
indicator('Chande Kroll Stop', { overlay: true });

const atrLength = input.int(10, 'ATR Length (p)');
const atrCoeff = input.int(1, 'ATR Coefficient (x)');
const stopLength = input.int(9, 'Stop Length (q)');
const highestHigh = ta.highest(high, atrLength);
const lowestLow = ta.lowest(low, atrLength);
const atr = ta.atr(atrLength);
const firstHighStop = highestHigh - atrCoeff * atr;
const firstLowStop = lowestLow + atrCoeff * atr;
const stopShort = ta.highest(firstHighStop, stopLength);
const stopLong = ta.lowest(firstLowStop, stopLength);

plot(stopLong, 'Stop Long');
plot(stopShort, 'Stop Short');`,
})

export default chandeKrollStop
