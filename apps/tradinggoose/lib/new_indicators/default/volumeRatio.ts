import { createDefaultPineIndicator } from '../create-default-indicator'

const volumeRatio = createDefaultPineIndicator({
  id: 'VR',
  name: 'Volume Ratio',
  pineCode: `
indicator('Volume Ratio');

const period = input.int(26, 'Length');
const maPeriod = input.int(6, 'MA Length');
const prevClose = close[1];
const vol = volume ?? 0;
const up = close > prevClose ? vol : 0;
const down = close < prevClose ? vol : 0;
const flat = close === prevClose ? vol : 0;
const upSum = math.sum(up, period);
const downSum = math.sum(down, period);
const flatSum = math.sum(flat, period);
const halfFlat = flatSum / 2;
const vr = (downSum + halfFlat) !== 0 ? (upSum + halfFlat) / (downSum + halfFlat) * 100 : NaN;
const maVr = ta.sma(vr, maPeriod);

plot(vr, 'VR');
plot(maVr, 'MAVR');`,
})

export default volumeRatio
