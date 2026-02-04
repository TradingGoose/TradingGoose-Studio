import { createDefaultPineIndicator } from '../create-default-indicator'

const donchian = createDefaultPineIndicator({
  id: 'DC',
  name: 'Donchian Channels',
  pineCode: `
indicator('Donchian Channels', { overlay: true });

const length = input.int(20, 'Length');
const upper = ta.highest(high, length);
const lower = ta.lowest(low, length);
const middle = (upper + lower) / 2;

plot(upper, 'Upper');
plot(middle, 'Basis');
plot(lower, 'Lower');`,
})

export default donchian
