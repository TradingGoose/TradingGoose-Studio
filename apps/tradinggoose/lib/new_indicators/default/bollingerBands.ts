import { createDefaultPineIndicator } from '../create-default-indicator'

const bollingerBands = createDefaultPineIndicator({
  id: 'BOLL',
  name: 'Bollinger Bands',
  pineCode: `
indicator('Bollinger Bands', { overlay: true });

const length = input.int(20, 'Length');
const mult = input.float(2, 'StdDev');
const [upper, middle, lower] = ta.bb(close, length, mult);

plot(upper, 'UP');
plot(middle, 'MID');
plot(lower, 'DN');`,
})

export default bollingerBands
