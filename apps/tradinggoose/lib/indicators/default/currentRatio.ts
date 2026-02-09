import { createDefaultIndicator } from '../create-default-indicator'

const currentRatio = createDefaultIndicator({
  id: 'CR',
  name: 'Current Ratio',
  pineCode: `
indicator('Current Ratio');

const period = input.int(26, 'Length');
const m1 = input.int(10, 'MA 1');
const m2 = input.int(20, 'MA 2');
const m3 = input.int(40, 'MA 3');
const m4 = input.int(60, 'MA 4');
const prevMid = (open[1] + high[1] + low[1] + close[1]) / 4;
const highSub = math.max(high - prevMid, 0);
const lowSub = math.max(prevMid - low, 0);
const highSum = math.sum(highSub, period);
const lowSum = math.sum(lowSub, period);
const cr = lowSum !== 0 ? highSum / lowSum * 100 : NaN;

const ma1 = ta.sma(cr, m1);
const ma2 = ta.sma(cr, m2);
const ma3 = ta.sma(cr, m3);
const ma4 = ta.sma(cr, m4);

const ma1Shift = Math.ceil(m1 / 2.5 + 1);
const ma2Shift = Math.ceil(m2 / 2.5 + 1);
const ma3Shift = Math.ceil(m3 / 2.5 + 1);
const ma4Shift = Math.ceil(m4 / 2.5 + 1);

plot(cr, 'CR');
plot(ma1[ma1Shift], 'MA1');
plot(ma2[ma2Shift], 'MA2');
plot(ma3[ma3Shift], 'MA3');
plot(ma4[ma4Shift], 'MA4');`,
})

export default currentRatio
