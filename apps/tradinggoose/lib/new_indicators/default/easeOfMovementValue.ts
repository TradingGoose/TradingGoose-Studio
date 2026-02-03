import { createDefaultPineIndicator } from './create-default-indicator'

const easeOfMovementValue = createDefaultPineIndicator({
  id: 'EMV',
  name: 'Ease of Movement Value',
  pineCode: `const { high, low, volume } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Ease of Movement Value');

const distance = (high + low) / 2 - (high[1] + low[1]) / 2;
const range = high - low;
const vol = volume ?? 0;
const ratio = range !== 0 ? vol / 100000000 / range : 0;
const emv = ratio !== 0 ? distance / ratio : 0;
const length = input.int(14, 'Length');
const maEmv = ta.sma(emv, length);

plot(emv, 'EMV');
plot(maEmv, 'MAEMV');`,
})

export default easeOfMovementValue
