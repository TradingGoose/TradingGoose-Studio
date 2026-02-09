import { createDefaultIndicator } from '../create-default-indicator'

const volume = createDefaultIndicator({
  id: 'VOL',
  name: 'Volume',
  pineCode: `
indicator('Volume');

plot(volume ?? 0, 'VOLUME', { style: plot.style_histogram });`,
})

export default volume
