import { createDefaultIndicator } from '../create-default-indicator'

const adx = createDefaultIndicator({
  id: 'ADX',
  name: 'Average Directional Index',
  pineCode: `
indicator('Average Directional Index');

const diLength = input.int(14, 'DI Length');
const adxSmoothing = input.int(14, 'ADX Smoothing');
const dmi = ta.dmi(diLength, adxSmoothing);
const adxValue = dmi[2];

plot(adxValue, 'ADX');`,
})

export default adx
