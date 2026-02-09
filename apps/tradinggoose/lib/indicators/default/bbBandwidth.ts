import { createDefaultIndicator } from '../create-default-indicator'

const bbBandwidth = createDefaultIndicator({
  id: 'BBW',
  name: 'Bollinger BandWidth',
  pineCode: `
indicator('Bollinger BandWidth');

const length = input.int(20, 'Length');
const mult = input.float(2, 'StdDev');
const expansionLength = input.int(125, 'Highest Expansion Length');
const contractionLength = input.int(125, 'Lowest Contraction Length');
const [upper, middle, lower] = ta.bb(close, length, mult);
const bandwidth = middle !== 0 ? (upper - lower) / middle * 100 : NaN;
const highestExpansion = ta.highest(bandwidth, expansionLength);
const lowestContraction = ta.lowest(bandwidth, contractionLength);

plot(bandwidth, 'Bollinger BandWidth');
plot(highestExpansion, 'Highest Expansion');
plot(lowestContraction, 'Lowest Contraction');`,
})

export default bbBandwidth
