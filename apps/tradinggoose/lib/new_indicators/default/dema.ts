import { createDefaultPineIndicator } from '../create-default-indicator'

const dema = createDefaultPineIndicator({
  id: 'DEMA',
  name: 'Double EMA',
  pineCode: `
indicator('Double EMA', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const ema1 = ta.ema(close, length);
const ema2 = ta.ema(ema1, length);
const demaValue = 2 * ema1 - ema2;

plot(demaValue, 'DEMA', { offset });`,
})

export default dema
