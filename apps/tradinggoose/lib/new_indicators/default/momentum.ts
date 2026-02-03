import { createDefaultPineIndicator } from './create-default-indicator'

const momentum = createDefaultPineIndicator({
  id: 'MTM',
  name: 'Momentum',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Momentum');

const length = input.int(12, 'Length');
const maLength = input.int(6, 'MA Length');
const mtm = ta.mom(close, length);
const maMtm = ta.sma(mtm, maLength);

plot(mtm, 'MTM');
plot(maMtm, 'MAMTM');`,
})

export default momentum
