import { createDefaultIndicator } from '../create-default-indicator'

const median = createDefaultIndicator({
  id: 'MEDIAN',
  name: 'Median',
  pineCode: `
indicator('Median', { overlay: true });

const length = input.int(3, 'Median Length');
const atrLength = input.int(14, 'ATR Length');
const atrMult = input.float(2, 'ATR Multiplier');
const hl2 = (high + low) / 2;
const medianValue = ta.median(hl2, length);
const atr = ta.atr(atrLength);
const upper = medianValue + atr * atrMult;
const lower = medianValue - atr * atrMult;
const medianEma = ta.ema(medianValue, length);

plot(medianValue, 'Median');
plot(upper, 'Upper Band');
plot(lower, 'Lower Band');
plot(medianEma, 'Median EMA');`,
})

export default median
