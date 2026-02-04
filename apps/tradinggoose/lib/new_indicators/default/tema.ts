import { createDefaultPineIndicator } from '../create-default-indicator'

const tema = createDefaultPineIndicator({
  id: 'TEMA',
  name: 'Triple EMA',
  pineCode: `
indicator('Triple EMA', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const ema1 = ta.ema(close, length);
const ema2 = ta.ema(ema1, length);
const ema3 = ta.ema(ema2, length);
const temaValue = 3 * ema1 - 3 * ema2 + ema3;

plot(temaValue, 'TEMA', { offset });`,
})

export default tema
