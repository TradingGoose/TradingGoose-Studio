import { createDefaultIndicator } from '../create-default-indicator'

const alma = createDefaultIndicator({
  id: 'ALMA',
  name: 'Arnaud Legoux Moving Average',
  pineCode: `
indicator('Arnaud Legoux Moving Average', { overlay: true });

const length = input.int(9, 'Length');
const offset = input.float(0.85, 'Offset');
const sigma = input.float(6, 'Sigma');
const almaValue = ta.alma(close, length, offset, sigma);

plot(almaValue, 'ALMA');`,
})

export default alma
