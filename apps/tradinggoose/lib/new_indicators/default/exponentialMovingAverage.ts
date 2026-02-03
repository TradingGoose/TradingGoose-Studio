import { createDefaultPineIndicator } from './create-default-indicator'

const exponentialMovingAverage = createDefaultPineIndicator({
  id: 'EMA',
  name: 'Exponential Moving Average',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Exponential Moving Average', { overlay: true });

const length1 = input.int(6, 'Length 1');
const length2 = input.int(12, 'Length 2');
const length3 = input.int(20, 'Length 3');

plot(ta.ema(close, length1), 'EMA6');
plot(ta.ema(close, length2), 'EMA12');
plot(ta.ema(close, length3), 'EMA20');`,
})

export default exponentialMovingAverage
