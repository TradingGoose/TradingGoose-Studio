import { createDefaultPineIndicator } from '../create-default-indicator'

const maCross = createDefaultPineIndicator({
  id: 'MACROSS',
  name: 'MA Cross',
  pineCode: `
indicator('MA Cross', { overlay: true });

const shortLength = input.int(9, 'Short Length');
const longLength = input.int(21, 'Long Length');
const shortMa = ta.sma(close, shortLength);
const longMa = ta.sma(close, longLength);

plot(shortMa, 'Short MA');
plot(longMa, 'Long MA');`,
})

export default maCross
