import { createDefaultIndicator } from '../create-default-indicator'

const brar = createDefaultIndicator({
  id: 'BRAR',
  name: 'Brar',
  pineCode: `
indicator('Brar');

const period = input.int(26, 'Length');
const prevClose = close[1];
const ho = math.max(high - open, 0);
const ol = math.max(open - low, 0);
const hcy = math.max(high - prevClose, 0);
const cyl = math.max(prevClose - low, 0);
const hoSum = math.sum(ho, period);
const olSum = math.sum(ol, period);
const hcySum = math.sum(hcy, period);
const cylSum = math.sum(cyl, period);
const ar = olSum !== 0 ? hoSum / olSum * 100 : NaN;
const br = cylSum !== 0 ? hcySum / cylSum * 100 : NaN;

plot(br, 'BR');
plot(ar, 'AR');`,
})

export default brar
