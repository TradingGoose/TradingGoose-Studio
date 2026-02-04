import { createDefaultPineIndicator } from '../create-default-indicator'

const williamsR = createDefaultPineIndicator({
  id: 'WR',
  name: 'Williams %R',
  pineCode: `
indicator('Williams %R');

const length = input.int(14, 'Length');
const wr = ta.wpr(length);

plot(wr, 'Williams %R');`,
})

export default williamsR
