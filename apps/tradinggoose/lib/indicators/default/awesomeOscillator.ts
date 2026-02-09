import { createDefaultIndicator } from '../create-default-indicator'

const awesomeOscillator = createDefaultIndicator({
  id: 'AO',
  name: 'Awesome Oscillator',
  pineCode: `

indicator('Awesome Oscillator');

const shortLength = input.int(5, 'Short Length');
const longLength = input.int(34, 'Long Length');
const ao = ta.sma(hl2, shortLength) - ta.sma(hl2, longLength);

plot(ao, 'AO', { style: plot.style_histogram });`,
})

export default awesomeOscillator
