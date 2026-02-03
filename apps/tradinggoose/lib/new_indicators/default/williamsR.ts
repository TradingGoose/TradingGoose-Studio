import { createDefaultPineIndicator } from './create-default-indicator'

const williamsR = createDefaultPineIndicator({
  id: 'WR',
  name: 'Williams %R',
  pineCode: `const { indicator, input, plot, ta } = $.pine;

indicator('Williams %R');

const length1 = input.int(6, 'Length 1');
const length2 = input.int(10, 'Length 2');
const length3 = input.int(14, 'Length 3');

plot(ta.wpr(length1), 'WR1');
plot(ta.wpr(length2), 'WR2');
plot(ta.wpr(length3), 'WR3');`,
})

export default williamsR
