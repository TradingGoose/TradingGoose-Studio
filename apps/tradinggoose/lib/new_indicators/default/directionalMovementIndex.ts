import { createDefaultPineIndicator } from './create-default-indicator'

const directionalMovementIndex = createDefaultPineIndicator({
  id: 'DMI',
  name: 'Directional Movement Index',
  pineCode: `const { indicator, input, plot, ta } = $.pine;

indicator('Directional Movement Index');

const length = input.int(14, 'Length');
const adxLength = input.int(6, 'ADX Length');
const [pdi, mdi, adx] = ta.dmi(length, adxLength);
const adxr = (adx + adx[adxLength]) / 2;

plot(pdi, 'PDI');
plot(mdi, 'MDI');
plot(adx, 'ADX');
plot(adxr, 'ADXR');`,
})

export default directionalMovementIndex
