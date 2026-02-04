import { createDefaultPineIndicator } from '../create-default-indicator'

const priceAndVolumeTrend = createDefaultPineIndicator({
  id: 'PVT',
  name: 'Price Volume Trend',
  pineCode: `
indicator('Price Volume Trend');

const pvt = ta.pvt();

plot(pvt, 'PVT');`,
})

export default priceAndVolumeTrend
