import { createDefaultIndicator } from '../create-default-indicator'

const stoch = createDefaultIndicator({
  id: 'STOCH',
  name: 'Stochastic',
  pineCode: `
indicator('Stochastic');

const periodK = input.int(14, '%K Length');
const smoothK = input.int(1, '%K Smoothing');
const periodD = input.int(3, '%D Smoothing');
const stochRaw = ta.stoch(close, high, low, periodK);
const k = ta.sma(stochRaw, smoothK);
const d = ta.sma(k, periodD);

plot(k, '%K');
plot(d, '%D');`,
})

export default stoch
