import { createDefaultPineIndicator } from '../create-default-indicator'

const stdev = createDefaultPineIndicator({
  id: 'STDEV',
  name: 'Standard Deviation',
  pineCode: `
indicator('Standard Deviation');

const length = input.int(20, 'Length');
const stdevValue = ta.stdev(close, length);

plot(stdevValue, 'StDev');`,
})

export default stdev
