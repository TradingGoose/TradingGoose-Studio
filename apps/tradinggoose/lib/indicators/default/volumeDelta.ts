import { createDefaultIndicator } from '../create-default-indicator'

const volumeDelta = createDefaultIndicator({
  id: 'VOLDELTA',
  name: 'Volume Delta',
  pineCode: `
indicator('Volume Delta');

const vol = volume ?? 0;
const delta = close > open ? vol : close < open ? -vol : 0;

plot(delta, 'Volume Delta', { style: plot.style_histogram });`,
})

export default volumeDelta
