import { createDefaultIndicator } from '../create-default-indicator'

const vwma = createDefaultIndicator({
  id: 'VWMA',
  name: 'Volume Weighted Moving Average',
  pineCode: `
indicator('Volume Weighted Moving Average', { overlay: true });

const length = input.int(20, 'Length');
const vwmaValue = ta.vwma(close, length);

plot(vwmaValue, 'VWMA');`,
})

export default vwma
