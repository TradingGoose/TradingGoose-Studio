import { createDefaultIndicator } from '../create-default-indicator'

const massIndex = createDefaultIndicator({
  id: 'MI',
  name: 'Mass Index',
  pineCode: `
indicator('Mass Index');

const length = input.int(10, 'Length');
const range = high - low;
const ema1 = ta.ema(range, 9);
const ema2 = ta.ema(ema1, 9);
const ratio = ema1 / ema2;
const mass = math.sum(ratio, length);

plot(mass, 'Mass Index');`,
})

export default massIndex
