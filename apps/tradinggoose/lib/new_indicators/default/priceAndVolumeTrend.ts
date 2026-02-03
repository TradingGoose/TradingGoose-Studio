import { createDefaultPineIndicator } from './create-default-indicator'

const priceAndVolumeTrend = createDefaultPineIndicator({
  id: 'PVT',
  name: 'Price and Volume Trend',
  pineCode: `const { close, volume } = $.data;
const { indicator, plot, ta } = $.pine;

indicator('Price and Volume Trend');

const prevClose = close[1];
const vol = volume ?? 1;
const denom = prevClose * vol;
const x = denom !== 0 ? (close - prevClose) / denom : 0;
const pvt = ta.cum(x);

plot(pvt, 'PVT');`,
})

export default priceAndVolumeTrend
