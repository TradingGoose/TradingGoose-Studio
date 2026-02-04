import { createDefaultPineIndicator } from '../create-default-indicator'

const bbTrend = createDefaultPineIndicator({
  id: 'BBTREND',
  name: 'BBTrend',
  pineCode: `
indicator('BBTrend');

const shortLength = input.int(20, 'Short BB Length');
const longLength = input.int(50, 'Long BB Length');
const stdDev = input.float(2, 'StdDev');
const shortMiddle = ta.sma(close, shortLength);
const shortDev = ta.stdev(close, shortLength) * stdDev;
const shortUpper = shortMiddle + shortDev;
const shortLower = shortMiddle - shortDev;
const longMiddle = ta.sma(close, longLength);
const longDev = ta.stdev(close, longLength) * stdDev;
const longUpper = longMiddle + longDev;
const longLower = longMiddle - longDev;
const bbTrendValue = shortMiddle !== 0
  ? (math.abs(shortLower - longLower) - math.abs(shortUpper - longUpper)) / shortMiddle * 100
  : NaN;

plot(bbTrendValue, 'BBTrend');`,
})

export default bbTrend
