import { createDefaultPineIndicator } from '../create-default-indicator'

const adx = createDefaultPineIndicator({
  id: 'ADX',
  name: 'Average Directional Index',
  pineCode: `
indicator('Average Directional Index');

const diLength = input.int(14, 'DI Length');
const adxSmoothing = input.int(14, 'ADX Smoothing');
const [, , adxValue] = ta.dmi(diLength, adxSmoothing);

plot(adxValue, 'ADX');`,
})

export default adx
