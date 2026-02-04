import { createDefaultPineIndicator } from '../create-default-indicator'

const exponentialMovingAverage = createDefaultPineIndicator({
  id: 'EMA',
  name: 'Exponential Moving Average',
  pineCode: `
indicator('Exponential Moving Average', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const ema = ta.ema(close, length);

plot(ema, 'EMA', { offset });`,
})

export default exponentialMovingAverage
