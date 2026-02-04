import { createDefaultPineIndicator } from '../create-default-indicator'

const bbPercentB = createDefaultPineIndicator({
  id: 'BBPB',
  name: 'Bollinger Bands %b',
  pineCode: `
indicator('Bollinger Bands %b');

const length = input.int(20, 'Length');
const mult = input.float(2, 'StdDev');
const [upper, , lower] = ta.bb(close, length, mult);
const denom = upper - lower;
const percentB = denom !== 0 ? (close - lower) / denom : NaN;

plot(percentB, 'Bollinger Bands %b');`,
})

export default bbPercentB
