import { createDefaultPineIndicator } from './create-default-indicator'

const awesomeOscillator = createDefaultPineIndicator({
  id: 'AO',
  name: 'Awesome Oscillator',
  pineCode: `const { hl2 } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Awesome Oscillator');

const shortLength = input.int(5, 'Short Length');
const longLength = input.int(34, 'Long Length');
const ao = ta.sma(hl2, shortLength) - ta.sma(hl2, longLength);

plot(ao, 'AO', { style: plot.style_histogram });`,
})

export default awesomeOscillator
