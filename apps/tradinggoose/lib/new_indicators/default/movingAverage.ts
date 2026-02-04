import { createDefaultPineIndicator } from '../create-default-indicator'

const movingAverage = createDefaultPineIndicator({
  id: 'MA',
  name: 'Moving Average',
  pineCode: `
indicator('Moving Average', { overlay: true });

const length1 = input.int(5, 'Length 1');
const length2 = input.int(10, 'Length 2');
const length3 = input.int(30, 'Length 3');
const length4 = input.int(60, 'Length 4');

plot(ta.sma(close, length1), 'MA5');
plot(ta.sma(close, length2), 'MA10');
plot(ta.sma(close, length3), 'MA30');
plot(ta.sma(close, length4), 'MA60');`,
})

export default movingAverage
