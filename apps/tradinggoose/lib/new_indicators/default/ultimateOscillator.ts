import { createDefaultPineIndicator } from '../create-default-indicator'

const ultimateOscillator = createDefaultPineIndicator({
  id: 'UO',
  name: 'Ultimate Oscillator',
  pineCode: `
indicator('Ultimate Oscillator');

const length1 = input.int(7, 'Fast Length');
const length2 = input.int(14, 'Middle Length');
const length3 = input.int(28, 'Slow Length');

const prevClose = close[1];
const highClose = math.max(high, prevClose);
const lowClose = math.min(low, prevClose);
const bp = close - lowClose;
const tr = highClose - lowClose;

const sumTR1 = math.sum(tr, length1);
const sumTR2 = math.sum(tr, length2);
const sumTR3 = math.sum(tr, length3);

const avg1 = sumTR1 !== 0 ? math.sum(bp, length1) / sumTR1 : 0;
const avg2 = sumTR2 !== 0 ? math.sum(bp, length2) / sumTR2 : 0;
const avg3 = sumTR3 !== 0 ? math.sum(bp, length3) / sumTR3 : 0;

const uo = 100 * (4 * avg1 + 2 * avg2 + avg3) / 7;

plot(uo, 'UO');`,
})

export default ultimateOscillator
