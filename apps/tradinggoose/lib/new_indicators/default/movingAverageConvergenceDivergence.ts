import { createDefaultPineIndicator } from '../create-default-indicator'

const movingAverageConvergenceDivergence = createDefaultPineIndicator({
  id: 'MACD',
  name: 'Moving Average Convergence Divergence',
  pineCode: `
indicator('Moving Average Convergence Divergence');

const fastLength = input.int(12, 'Fast Length');
const slowLength = input.int(26, 'Slow Length');
const signalLength = input.int(9, 'Signal Length');
const [macdLine, signalLine, hist] = ta.macd(close, fastLength, slowLength, signalLength);

plot(hist, 'Histogram', { style: plot.style_histogram });
plot(macdLine, 'MACD');
plot(signalLine, 'Signal');`,
})

export default movingAverageConvergenceDivergence
