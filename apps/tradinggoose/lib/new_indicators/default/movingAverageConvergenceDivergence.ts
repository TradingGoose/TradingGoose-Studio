import { createDefaultPineIndicator } from './create-default-indicator'

const movingAverageConvergenceDivergence = createDefaultPineIndicator({
  id: 'MACD',
  name: 'Moving Average Convergence Divergence',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Moving Average Convergence Divergence');

const fastLength = input.int(12, 'Fast Length');
const slowLength = input.int(26, 'Slow Length');
const signalLength = input.int(9, 'Signal Length');
const [dif, dea, hist] = ta.macd(close, fastLength, slowLength, signalLength);
const macd = hist * 2;

plot(dif, 'DIF');
plot(dea, 'DEA');
plot(macd, 'MACD', { style: plot.style_histogram });`,
})

export default movingAverageConvergenceDivergence
