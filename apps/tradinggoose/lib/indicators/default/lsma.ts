import { createDefaultIndicator } from '../create-default-indicator'

const lsma = createDefaultIndicator({
  id: 'LSMA',
  name: 'Least Squares Moving Average',
  pineCode: `
indicator('Least Squares Moving Average', { overlay: true });

const length = input.int(25, 'Length');
const offset = input.int(0, 'Offset');
const lsmaValue = ta.linreg(close, length, offset);

plot(lsmaValue, 'LSMA');`,
})

export default lsma
