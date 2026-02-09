import { createDefaultIndicator } from '../create-default-indicator'

const historicalVolatility = createDefaultIndicator({
  id: 'HV',
  name: 'Historical Volatility',
  pineCode: `
indicator('Historical Volatility');

const length = input.int(10, 'Length');
const annual = input.int(365, 'Annual');
const per = input.int(1, 'Period');
const logReturn = close[1] !== 0 ? math.log(close / close[1]) : NaN;
const stdev = ta.stdev(logReturn, length);
const multiplier = 100 * math.sqrt(annual / per);
const hv = stdev * multiplier;

plot(hv, 'HV');`,
})

export default historicalVolatility
