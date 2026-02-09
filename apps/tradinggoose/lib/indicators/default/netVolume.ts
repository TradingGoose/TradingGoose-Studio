import { createDefaultIndicator } from '../create-default-indicator'

const netVolume = createDefaultIndicator({
  id: 'NETVOL',
  name: 'Net Volume',
  pineCode: `
indicator('Net Volume');

const vol = volume ?? 0;
const delta = close > open ? vol : close < open ? -vol : 0;

plot(delta, 'Net Volume');`,
})

export default netVolume
