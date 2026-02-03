import { createDefaultPineIndicator } from './create-default-indicator'

const volume = createDefaultPineIndicator({
  id: 'VOL',
  name: 'Volume',
  pineCode: `const { volume: vol } = $.data;
const { indicator, plot } = $.pine;

indicator('Volume');

plot(vol ?? 0, 'VOLUME', { style: plot.style_histogram });`,
})

export default volume
