import { createDefaultIndicator } from '../create-default-indicator'

const bollingerBands = createDefaultIndicator({
  id: 'BOLL',
  name: 'Bollinger Bands',
  pineCode: `
indicator('Bollinger Bands', { overlay: true });

const length = input.int(20, 'Length');
const mult = input.float(2, 'StdDev');
const [middle, upper, lower] = ta.bb(close, length, mult);

const upperPlot = plot(upper, 'UP', { color: '#F23645' });
plot(middle, 'MID', { color: '#2962FF' });
const lowerPlot = plot(lower, 'DN', { color: '#089981' });
fill(upperPlot, lowerPlot);`,
})

export default bollingerBands
