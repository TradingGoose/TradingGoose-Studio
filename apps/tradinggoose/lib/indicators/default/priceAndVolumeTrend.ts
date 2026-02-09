import { createDefaultIndicator } from '../create-default-indicator'

const priceAndVolumeTrend = createDefaultIndicator({
  id: 'PVT',
  name: 'Price Volume Trend',
  pineCode: `
indicator('Price Volume Trend');

const pvt = ta.pvt();

plot(pvt, 'PVT');`,
})

export default priceAndVolumeTrend
