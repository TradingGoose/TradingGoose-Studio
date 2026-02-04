import { createDefaultPineIndicator } from '../create-default-indicator'

const stochRsi = createDefaultPineIndicator({
  id: 'STOCHRSI',
  name: 'Stochastic RSI',
  pineCode: `
indicator('Stochastic RSI');

const smoothK = input.int(3, 'K');
const smoothD = input.int(3, 'D');
const lengthRsi = input.int(14, 'RSI Length');
const lengthStoch = input.int(14, 'Stochastic Length');
const rsi = ta.rsi(close, lengthRsi);
const stochRsi = ta.stoch(rsi, rsi, rsi, lengthStoch);
const k = ta.sma(stochRsi, smoothK);
const d = ta.sma(k, smoothD);

plot(k, 'K');
plot(d, 'D');`,
})

export default stochRsi
