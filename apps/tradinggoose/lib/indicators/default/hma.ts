import { createDefaultIndicator } from '../create-default-indicator'

const hma = createDefaultIndicator({
  id: 'HMA',
  name: 'Hull Moving Average',
  pineCode: `
indicator('Hull Moving Average', { overlay: true });

const length = input.int(9, 'Length');
const hmaValue = ta.hma(close, length);

plot(hmaValue, 'HMA');`,
})

export default hma
