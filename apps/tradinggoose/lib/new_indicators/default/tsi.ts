import { createDefaultPineIndicator } from '../create-default-indicator'

const tsi = createDefaultPineIndicator({
  id: 'TSI',
  name: 'True Strength Index',
  pineCode: `
indicator('True Strength Index');

const longLength = input.int(25, 'Long Length');
const shortLength = input.int(13, 'Short Length');
const signalLength = input.int(13, 'Signal Length');
const tsiValue = ta.tsi(close, shortLength, longLength) * 100;
const signal = ta.ema(tsiValue, signalLength);

plot(tsiValue, 'True Strength Index');
plot(signal, 'Signal');`,
})

export default tsi
