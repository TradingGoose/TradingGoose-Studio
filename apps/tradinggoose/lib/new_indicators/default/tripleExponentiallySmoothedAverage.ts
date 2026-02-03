import { createDefaultPineIndicator } from './create-default-indicator'

const tripleExponentiallySmoothedAverage = createDefaultPineIndicator({
  id: 'TRIX',
  name: 'Triple Exponentially Smoothed Average',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Triple Exponentially Smoothed Average');

const length = input.int(12, 'Length');
const maLength = input.int(9, 'MA Length');
const ema1 = ta.ema(close, length);
const ema2 = ta.ema(ema1, length);
const ema3 = ta.ema(ema2, length);
const trix = ema3[1] !== 0 ? (ema3 - ema3[1]) / ema3[1] * 100 : NaN;
const maTrix = ta.sma(trix, maLength);

plot(trix, 'TRIX');
plot(maTrix, 'MATRIX');`,
})

export default tripleExponentiallySmoothedAverage
