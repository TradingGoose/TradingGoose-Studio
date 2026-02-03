import { createDefaultPineIndicator } from './create-default-indicator'

const stopAndReverse = createDefaultPineIndicator({
  id: 'SAR',
  name: 'Stop and Reverse',
  pineCode: `const { indicator, input, plot, ta } = $.pine;

indicator('Stop and Reverse', { overlay: true });

const start = input.float(0.02, 'Start');
const increment = input.float(0.02, 'Increment');
const maximum = input.float(0.2, 'Maximum');
const sar = ta.sar(start, increment, maximum);

plot(sar, 'SAR', { style: plot.style_circles });`,
})

export default stopAndReverse
