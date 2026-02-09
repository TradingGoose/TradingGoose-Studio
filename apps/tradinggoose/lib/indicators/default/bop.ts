import { createDefaultIndicator } from '../create-default-indicator'

const bop = createDefaultIndicator({
  id: 'BOP',
  name: 'Balance of Power',
  pineCode: `
indicator('Balance of Power');

const range = high - low;
const bopValue = range !== 0 ? (close - open) / range : NaN;

plot(bopValue, 'BOP');`,
})

export default bop
