import { createDefaultPineIndicator } from '../create-default-indicator'

const priceOscillator = createDefaultPineIndicator({
  id: 'PPO',
  name: 'Price Oscillator',
  pineCode: `
indicator('Price Oscillator');

const shortLength = input.int(12, 'Short Length');
const longLength = input.int(26, 'Long Length');
const signalLength = input.int(9, 'Signal Length');
const exponential = input.bool(true, 'Use Exponential MA');
const shortMa = exponential ? ta.ema(close, shortLength) : ta.sma(close, shortLength);
const longMa = exponential ? ta.ema(close, longLength) : ta.sma(close, longLength);
const ppo = longMa !== 0 ? (shortMa - longMa) / longMa * 100 : NaN;
const signal = exponential ? ta.ema(ppo, signalLength) : ta.sma(ppo, signalLength);
const hist = ppo - signal;

plot(hist, 'Histogram', { style: plot.style_histogram });
plot(ppo, 'PPO');
plot(signal, 'Signal');`,
})

export default priceOscillator
