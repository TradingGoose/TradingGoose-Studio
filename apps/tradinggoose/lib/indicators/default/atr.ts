import { createDefaultIndicator } from '../create-default-indicator'

const atr = createDefaultIndicator({
  id: 'ATR',
  name: 'Average True Range',
  pineCode: `
indicator('Average True Range');

const length = input.int(14, 'Length');
const atrValue = ta.atr(length);

plot(atrValue, 'ATR');`,
})

export default atr
