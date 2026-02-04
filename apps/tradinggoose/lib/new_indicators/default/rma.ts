import { createDefaultPineIndicator } from '../create-default-indicator'

const rma = createDefaultPineIndicator({
  id: 'RMA',
  name: 'Smoothed Moving Average',
  pineCode: `
indicator('Smoothed Moving Average', { overlay: true });

const length = input.int(7, 'Length');
const rmaValue = ta.rma(close, length);

plot(rmaValue, 'SMMA');`,
})

export default rma
