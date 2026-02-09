import { createDefaultIndicator } from '../create-default-indicator'

const smma = createDefaultIndicator({
  id: 'SMMA',
  name: 'Smoothed Moving Average',
  pineCode: `
indicator('Smoothed Moving Average', { overlay: true });

const length = input.int(7, 'Length');
const smmaValue = ta.rma(close, length);

plot(smmaValue, 'SMMA');`,
})

export default smma
