import { createDefaultPineIndicator } from '../create-default-indicator'

const wma = createDefaultPineIndicator({
  id: 'WMA',
  name: 'Moving Average Weighted',
  pineCode: `
indicator('Moving Average Weighted', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.int(0, 'Offset');
const wmaValue = ta.wma(close, length);

plot(wmaValue, 'WMA', { offset });`,
})

export default wma
