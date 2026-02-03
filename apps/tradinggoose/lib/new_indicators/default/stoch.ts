import { createDefaultPineIndicator } from './create-default-indicator'

const stoch = createDefaultPineIndicator({
  id: 'STOCH',
  name: 'Stochastic',
  pineCode: `const { close, high, low } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Stochastic');

const length = input.int(9, 'Length');
const smoothK = input.int(3, 'Smooth K');
const smoothD = input.int(3, 'Smooth D');
const rsv = ta.stoch(close, high, low, length);
const k = ta.rma(rsv, smoothK);
const d = ta.rma(k, smoothD);
const j = 3 * k - 2 * d;

plot(k, 'K');
plot(d, 'D');
plot(j, 'J');`,
})

export default stoch
