import { createDefaultPineIndicator } from '../create-default-indicator'

const adr = createDefaultPineIndicator({
  id: 'ADR',
  name: 'Average Day Range',
  pineCode: `
indicator('Average Day Range');

const length = input.int(14, 'Length');
const range = high - low;
const adr = ta.sma(range, length);

plot(adr, 'ADR');`,
})

export default adr
