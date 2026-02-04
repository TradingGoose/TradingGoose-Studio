import { createDefaultPineIndicator } from '../create-default-indicator'

const simpleMovingAverage = createDefaultPineIndicator({
  id: 'SMA',
  name: 'Simple Moving Average',
  pineCode: `
indicator('Simple Moving Average', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const sma = ta.sma(close, length);

plot(sma, 'MA', { offset });`,
})

export default simpleMovingAverage
