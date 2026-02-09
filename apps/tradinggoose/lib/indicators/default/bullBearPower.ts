import { createDefaultIndicator } from '../create-default-indicator'

const bullBearPower = createDefaultIndicator({
  id: 'BBP',
  name: 'Bull Bear Power',
  pineCode: `
indicator('Bull Bear Power');

const length = input.int(13, 'Length');
const ema = ta.ema(close, length);
const bullPower = high - ema;
const bearPower = low - ema;
const bbp = bullPower + bearPower;

plot(bbp, 'BBPower');`,
})

export default bullBearPower
