import { createDefaultPineIndicator } from '../create-default-indicator'

const momentum = createDefaultPineIndicator({
  id: 'MTM',
  name: 'Momentum',
  pineCode: `
indicator('Momentum');

const length = input.int(10, 'Length');
const mom = ta.mom(close, length);

plot(mom, 'Mom');`,
})

export default momentum
