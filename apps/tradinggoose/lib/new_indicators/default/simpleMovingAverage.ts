import { createDefaultPineIndicator } from './create-default-indicator'

const simpleMovingAverage = createDefaultPineIndicator({
  id: 'SMA',
  name: 'Simple Moving Average',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Simple Moving Average', { overlay: true });

const length = input.int(12, 'Length');

plot(ta.ema(close, length), 'SMA');`,
})

export default simpleMovingAverage
