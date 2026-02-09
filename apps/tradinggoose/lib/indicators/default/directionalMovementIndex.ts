import { createDefaultIndicator } from '../create-default-indicator'

const directionalMovementIndex = createDefaultIndicator({
  id: 'DMI',
  name: 'Directional Movement Index',
  pineCode: `
indicator('Directional Movement Index');

const diLength = input.int(14, 'DI Length');
const adxSmoothing = input.int(14, 'ADX Smoothing');
const [pdi, mdi, adx] = ta.dmi(diLength, adxSmoothing);

plot(adx, 'ADX');
plot(pdi, '+DI');
plot(mdi, '-DI');`,
})

export default directionalMovementIndex
