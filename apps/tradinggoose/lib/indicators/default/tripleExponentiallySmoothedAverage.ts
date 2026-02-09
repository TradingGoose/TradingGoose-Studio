import { createDefaultIndicator } from '../create-default-indicator'

const tripleExponentiallySmoothedAverage = createDefaultIndicator({
  id: 'TRIX',
  name: 'TRIX',
  pineCode: `
indicator('TRIX');

const length = input.int(18, 'Length');
const logClose = math.log(close);
const ema1 = ta.ema(logClose, length);
const ema2 = ta.ema(ema1, length);
const ema3 = ta.ema(ema2, length);
const trix = ta.change(ema3, 1) * 10000;

plot(trix, 'TRIX');`,
})

export default tripleExponentiallySmoothedAverage
