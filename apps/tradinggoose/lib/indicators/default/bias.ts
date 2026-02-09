import { createDefaultIndicator } from '../create-default-indicator'

const bias = createDefaultIndicator({
  id: 'BIAS',
  name: 'Bias',
  pineCode: `
indicator('Bias');

const length1 = input.int(6, 'Length 1');
const length2 = input.int(12, 'Length 2');
const length3 = input.int(24, 'Length 3');
const ma6 = ta.sma(close, length1);
const ma12 = ta.sma(close, length2);
const ma24 = ta.sma(close, length3);
const bias6 = ma6 !== 0 ? (close - ma6) / ma6 * 100 : NaN;
const bias12 = ma12 !== 0 ? (close - ma12) / ma12 * 100 : NaN;
const bias24 = ma24 !== 0 ? (close - ma24) / ma24 * 100 : NaN;

plot(bias6, 'BIAS6');
plot(bias12, 'BIAS12');
plot(bias24, 'BIAS24');`,
})

export default bias
