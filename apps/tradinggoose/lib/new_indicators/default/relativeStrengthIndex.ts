import { createDefaultPineIndicator } from '../create-default-indicator'

const relativeStrengthIndex = createDefaultPineIndicator({
  id: 'RSI',
  name: 'Relative Strength Index',
  pineCode: `
indicator('Relative Strength Index');

const length = input.int(14, 'Length');
const rsi = ta.rsi(close, length);

plot(rsi, 'RSI');`,
})

export default relativeStrengthIndex
