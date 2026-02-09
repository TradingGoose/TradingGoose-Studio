import { createDefaultIndicator } from '../create-default-indicator'

const williamsR = createDefaultIndicator({
  id: 'WR',
  name: 'Williams %R',
  pineCode: `
indicator('Williams %R');

const length = input.int(14, 'Length');
const wr = ta.wpr(length);

plot(wr, 'Williams %R');`,
})

export default williamsR
